// src-tauri/src/kinetic_live.rs
// ============================================================================
// KINETIC ENGINE: LIVE MIDI PUSH ENGINE
//
// No artificial per-message floor is imposed by default (MIN_SEND_INTERVAL
// = 0) -- the JS-side producer rate (LIVE_PUSH_RATE_PRESETS in
// livePush.js) is the one user-facing "smoothness" control.
// The only remaining pacing is whatever midir's conn.send() itself 
// blocks on at the OS/driver level, which is the genuine 
// hardware/driver-imposed floor, not an artificial one.
// ============================================================================

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use midir::{MidiOutput, MidiOutputConnection};

const SYSEX_HEADER: [u8; 7] = [0xF0, 0x00, 0x20, 0x29, 0x02, 0x10, 0x0B];
const SYSEX_FOOTER: u8 = 0xF7;

const MAX_PADS_PER_MESSAGE: usize = 24;

// No floor by default -- see module doc. Left as a named constant (rather
// than inlined 0) so it's an obvious, single place to reintroduce a safety
// floor later if a specific unit/firmware combination ever needs one.
const MIN_SEND_INTERVAL: Duration = Duration::from_millis(0);

// How long to spin-check the sequence counter before falling back to a
// blocking condvar wait. Time-based (not iteration-count-based) so it
// behaves consistently across CPUs of different speeds.
const SPIN_WINDOW: Duration = Duration::from_micros(750);
// Condvar wait granularity while parked/idle -- just a backstop so the
// stop flag still gets noticed promptly even with nothing incoming; the
// condvar's own notify_one() wakes it immediately regardless of this.
const IDLE_WAIT_TIMEOUT: Duration = Duration::from_millis(5);

struct DeviceShared {
    seq: AtomicU64,                    // bumped on every kinetic_live_push -- the actual wake signal
    data: Mutex<(u8, Vec<u8>)>,        // (tolerance, latest flat frame [addr,r,g,b,...])
    idle_gate: Mutex<()>,              // paired with condvar purely for the idle-park fallback
    condvar: Condvar,
}

struct DeviceChannel {
    shared: Arc<DeviceShared>,
    stop_flag: Arc<AtomicBool>,
}

pub struct KineticLiveState {
    devices: HashMap<String, DeviceChannel>,
}

impl KineticLiveState {
    pub fn new() -> Self {
        Self { devices: HashMap::new() }
    }
}

fn stop_existing(state: &mut KineticLiveState, key: &str) {
    if let Some(channel) = state.devices.remove(key) {
        channel.stop_flag.store(true, Ordering::SeqCst);
        channel.shared.condvar.notify_all(); // wake it if parked so it notices the stop flag
    }
}

#[tauri::command]
pub fn kinetic_live_connect(
    state: tauri::State<Mutex<KineticLiveState>>,
    key: String,
    port_name: String,
) -> Result<(), String> {
    let output = MidiOutput::new("aerolux-kinetic-live").map_err(|e| e.to_string())?;
    let port = output
        .ports()
        .into_iter()
        .find(|p| output.port_name(p).unwrap_or_default() == port_name)
        .ok_or("Output port not found")?;
    let mut conn = output
        .connect(&port, "aerolux-kinetic-live-out")
        .map_err(|e| e.to_string())?;

    let shared = Arc::new(DeviceShared {
        seq: AtomicU64::new(0),
        data: Mutex::new((0, Vec::new())),
        idle_gate: Mutex::new(()),
        condvar: Condvar::new(),
    });
    let stop_flag = Arc::new(AtomicBool::new(false));

    let thread_shared = shared.clone();
    let thread_stop = stop_flag.clone();

    thread::spawn(move || {
        // Last-SENT state, owned exclusively by this thread -- no lock
        // needed, nothing else ever reads or writes it.
        let mut last_sent: HashMap<u8, [u8; 3]> = HashMap::new();
        let mut last_seen_seq: u64 = 0;
        let mut last_send_at = Instant::now()
            .checked_sub(MIN_SEND_INTERVAL)
            .unwrap_or_else(Instant::now); // allow an immediate first send

        loop {
            if thread_stop.load(Ordering::SeqCst) {
                break;
            }

            // ── Wait for new data: spin first (near-zero latency), park
            // only after a genuine idle stretch (so a paused device doesn't
            // burn a full core forever). ──────────────────────────────────
            let spin_deadline = Instant::now() + SPIN_WINDOW;
            while thread_shared.seq.load(Ordering::Acquire) == last_seen_seq {
                if thread_stop.load(Ordering::SeqCst) {
                    return;
                }
                if Instant::now() >= spin_deadline {
                    let guard = thread_shared.idle_gate.lock().unwrap();
                    let _ = thread_shared
                        .condvar
                        .wait_timeout(guard, IDLE_WAIT_TIMEOUT)
                        .unwrap();
                    // Falls through to re-check the seq counter immediately
                    // on every wake, whether from notify_one() or timeout.
                } else {
                    std::hint::spin_loop();
                }
            }

            // ── New data is ready. Gate against the floor (if any) RIGHT
            // BEFORE acting, rather than sleeping after every send -- this
            // is the detail that actually matters for latency. ───────────
            if MIN_SEND_INTERVAL > Duration::ZERO {
                let elapsed = last_send_at.elapsed();
                if elapsed < MIN_SEND_INTERVAL {
                    thread::sleep(MIN_SEND_INTERVAL - elapsed);
                }
            }

            let seq_now = thread_shared.seq.load(Ordering::Acquire);
            let (tolerance, flat) = {
                let guard = thread_shared.data.lock().unwrap();
                guard.clone() // small (typically <500 bytes) -- copy out, hold the lock briefly
            };
            last_seen_seq = seq_now;

            let mut pad_data = Vec::new();
            let mut i = 0;
            while i + 3 < flat.len() {
                let (addr, r, g, b) = (flat[i], flat[i + 1], flat[i + 2], flat[i + 3]);
                i += 4;

                let changed = match last_sent.get(&addr) {
                    Some(prev) => {
                        (prev[0] as i16 - r as i16).abs() > tolerance as i16
                            || (prev[1] as i16 - g as i16).abs() > tolerance as i16
                            || (prev[2] as i16 - b as i16).abs() > tolerance as i16
                    }
                    None => true,
                };

                if changed {
                    last_sent.insert(addr, [r, g, b]);
                    pad_data.push(addr);
                    pad_data.push(r);
                    pad_data.push(g);
                    pad_data.push(b);
                }
            }

            if pad_data.is_empty() {
                continue; // nothing perceptibly changed -- skip the write entirely, no sleep needed
            }

            // pad_data is quads of [addr,r,g,b] -- always a multiple of 4
            // bytes, so chunking by MAX_PADS_PER_MESSAGE*4 always lands on
            // whole pad boundaries, never splitting one pad's entry across
            // two messages.
            for chunk in pad_data.chunks(MAX_PADS_PER_MESSAGE * 4) {
                let mut msg = Vec::with_capacity(SYSEX_HEADER.len() + chunk.len() + 1);
                msg.extend_from_slice(&SYSEX_HEADER);
                msg.extend_from_slice(chunk);
                msg.push(SYSEX_FOOTER);
                let _ = conn.send(&msg); // best-effort -- one dropped write shouldn't kill the thread
            }
            last_send_at = Instant::now();
        }
    });

    let mut guard = state.lock().unwrap();
    stop_existing(&mut guard, &key); // replace any prior connection/thread for this key
    guard.devices.insert(key, DeviceChannel { shared, stop_flag });
    Ok(())
}

/// Overwrites the single-slot "latest frame" for a device and bumps its
/// sequence counter -- the device's thread notices via its spin/park loop.
/// Returns immediately; never blocks on hardware I/O. Silently no-ops if
/// the device isn't connected.
#[tauri::command]
pub fn kinetic_live_push(
    state: tauri::State<Mutex<KineticLiveState>>,
    key: String,
    frame: Vec<u8>,
    tolerance: u8,
) {
    let guard = state.lock().unwrap();
    if let Some(channel) = guard.devices.get(&key) {
        *channel.shared.data.lock().unwrap() = (tolerance, frame);
        channel.shared.seq.fetch_add(1, Ordering::Release);
        channel.shared.condvar.notify_one(); // wakes it instantly if it's parked in the idle fallback
    }
}

#[tauri::command]
pub fn kinetic_live_disconnect(state: tauri::State<Mutex<KineticLiveState>>, key: String) {
    let mut guard = state.lock().unwrap();
    stop_existing(&mut guard, &key);
}