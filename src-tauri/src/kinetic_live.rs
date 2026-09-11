// src-tauri/src/kinetic_live.rs
// ============================================================================
// KINETIC LIVE OUTPUT
//
// One invoke() per frame carries ALL changed devices in a single batched
// payload (kinetic_live_push_batch), instead of one invoke() per device.
// Each device still gets its own OS thread + its own last-sent diff buffer,
// so a slow/dead port never blocks another device's frame.
//
// Payload format (see JS livePush.js for the producer):
//   concat of per-device slices, one slice per CHANGED device only:
//   [device_index: u8][r,g,b * PAD_COUNT]
//   fixed slice length = 1 + PAD_COUNT*3 bytes.
//
// Disconnect handling: a failed send() OR the background port-poll marks a
// device paused and emits 'kinetic:device-disconnected'. The device's
// thread stays alive, blocked, until kinetic_live_connect() is called again
// for it (reconnect or a new port pick).
// ============================================================================

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use midir::{MidiOutput, MidiOutputConnection};
use tauri::{AppHandle, Emitter, Manager};

const SYSEX_HEADER: [u8; 7] = [0xF0, 0x00, 0x20, 0x29, 0x02, 0x10, 0x0B];
const SYSEX_FOOTER: u8 = 0xF7;
const MAX_PADS_PER_MESSAGE: usize = 24;

const SPIN_WINDOW: Duration = Duration::from_micros(750);
const IDLE_WAIT_TIMEOUT: Duration = Duration::from_millis(5);
const PORT_POLL_INTERVAL: Duration = Duration::from_millis(750);

// pad address list a device actually samples, resolved once per device from
// its logo/mode export choice. (addr, r-offset) pairs into the flat frame.
pub type AddressList = Vec<u8>; // sysex/live addresses, in the same order the JS-side frame packs them

// ── per-device shared state ─────────────────────────────────────────

struct DeviceShared {
    seq: AtomicU64,                       // bumped on every pending-frame write; the thread's wake signal
    pending: Mutex<Option<Vec<(u8, [u8; 3])>>>, // latest unsent frame (addr, rgb) pairs. None = nothing new.
    last_sent: Mutex<HashMap<u8, [u8; 3]>>, // addr -> last colour actually written, cleared on (re)connect
    quantize: Mutex<Option<QuantizeConfig>>, // None = full SysEx colour, Some = snap to palette first
    connected: AtomicBool,
    idle_gate: Mutex<()>,
    condvar: Condvar,
}

struct QuantizeConfig {
    palette: Vec<[u8; 3]>, // index -> rgb, index 0 reserved/skipped same as everywhere else
}

struct DeviceChannel {
    port_name: String,
    shared: Arc<DeviceShared>,
    addresses: AddressList,
    stop_flag: Arc<AtomicBool>,
}

// device_index must be stable across the session so JS's per-frame batch
// payload can address a device by a single byte without re-sending its
// (variable-length) id string every frame. assigned once at connect,
// never reused for a different device while the app is running (a HashMap
// index into `devices` would NOT be stable across removals, hence this).
pub struct KineticLiveState {
    devices: HashMap<String, DeviceChannel>, // device_id -> channel
    index_to_key: HashMap<u8, String>,
    key_to_index: HashMap<String, u8>,
    next_index: u8,
}

impl Default for KineticLiveState {
    fn default() -> Self {
        Self {
            devices: HashMap::new(),
            index_to_key: HashMap::new(),
            key_to_index: HashMap::new(),
            next_index: 0,
        }
    }
}

pub fn init_state() -> Mutex<KineticLiveState> {
    Mutex::new(KineticLiveState::default())
}

fn stop_existing(state: &mut KineticLiveState, key: &str) {
    if let Some(ch) = state.devices.remove(key) {
        ch.stop_flag.store(true, Ordering::SeqCst);
        ch.shared.condvar.notify_all();
    }
}

fn assign_index(state: &mut KineticLiveState, key: &str) -> u8 {
    if let Some(&idx) = state.key_to_index.get(key) {
        return idx;
    }
    let idx = state.next_index;
    state.next_index = state.next_index.wrapping_add(1);
    state.key_to_index.insert(key.to_string(), idx);
    state.index_to_key.insert(idx, key.to_string());
    idx
}

// nearest-palette-index lookup, cached per (r,g,b) key for the lifetime of
// one QuantizeConfig. cheap regardless (<=127 entries) but avoided per-pad
// where possible.
fn quantize_rgb(rgb: [u8; 3], cfg: &QuantizeConfig, cache: &mut HashMap<u32, [u8; 3]>) -> [u8; 3] {
    let key = (rgb[0] as u32) << 16 | (rgb[1] as u32) << 8 | rgb[2] as u32;
    if let Some(hit) = cache.get(&key) {
        return *hit;
    }
    let mut best = rgb;
    let mut best_dist = i32::MAX;
    for (i, entry) in cfg.palette.iter().enumerate() {
        if i == 0 { continue; }
        let dr = entry[0] as i32 - rgb[0] as i32;
        let dg = entry[1] as i32 - rgb[1] as i32;
        let db = entry[2] as i32 - rgb[2] as i32;
        let dist = dr * dr + dg * dg + db * db;
        if dist < best_dist {
            best_dist = dist;
            best = *entry;
        }
    }
    cache.insert(key, best);
    best
}

// ── connect ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn kinetic_live_connect(
    app: AppHandle,
    state: tauri::State<Mutex<KineticLiveState>>,
    key: String,
    port_name: String,
    addresses: AddressList,
    tolerance: Option<u8>,
) -> Result<u8, String> {
    let output = MidiOutput::new("aerolux-kinetic-live").map_err(|e| e.to_string())?;
    let port = output
        .ports()
        .into_iter()
        .find(|p| output.port_name(p).unwrap_or_default() == port_name)
        .ok_or("Output port not found")?;
    let conn = output
        .connect(&port, "aerolux-kinetic-live-out")
        .map_err(|e| e.to_string())?;

    let shared = Arc::new(DeviceShared {
        seq: AtomicU64::new(0),
        pending: Mutex::new(None),
        last_sent: Mutex::new(HashMap::new()), // empty = next frame is a full resend, always
        quantize: Mutex::new(None),
        connected: AtomicBool::new(true),
        idle_gate: Mutex::new(()),
        condvar: Condvar::new(),
    });
    let stop_flag = Arc::new(AtomicBool::new(false));

    let tolerance_val = tolerance.unwrap_or(0);
    spawn_device_thread(app, key.clone(), conn, shared.clone(), stop_flag.clone(), tolerance_val);

    let mut guard = state.lock().unwrap();
    stop_existing(&mut guard, &key);
    let index = assign_index(&mut guard, &key);
    guard.devices.insert(key, DeviceChannel { port_name, shared, addresses, stop_flag });
    Ok(index)
}

fn spawn_device_thread(
    app: AppHandle,
    key: String,
    mut conn: MidiOutputConnection,
    shared: Arc<DeviceShared>,
    stop_flag: Arc<AtomicBool>,
    tolerance: u8,
) {
    thread::spawn(move || {
        let mut last_seen_seq: u64 = 0;
        let mut quantize_cache: HashMap<u32, [u8; 3]> = HashMap::new();

        loop {
            if stop_flag.load(Ordering::SeqCst) {
                return;
            }
            if !shared.connected.load(Ordering::SeqCst) {
                // paused after a disconnect. park on the condvar until
                // reconnected (kinetic_live_connect replaces this whole
                // DeviceChannel, which also flips stop_flag, so a stuck
                // park here always resolves via that path).
                let guard = shared.idle_gate.lock().unwrap();
                let _ = shared.condvar.wait_timeout(guard, IDLE_WAIT_TIMEOUT);
                continue;
            }

            // spin briefly for near-zero latency, then park.
            let spin_deadline = Instant::now() + SPIN_WINDOW;
            while shared.seq.load(Ordering::Acquire) == last_seen_seq {
                if stop_flag.load(Ordering::SeqCst) { return; }
                if Instant::now() >= spin_deadline {
                    let guard = shared.idle_gate.lock().unwrap();
                    let _ = shared.condvar.wait_timeout(guard, IDLE_WAIT_TIMEOUT);
                } else {
                    std::hint::spin_loop();
                }
            }

            let seq_now = shared.seq.load(Ordering::Acquire);
            let frame = shared.pending.lock().unwrap().take();
            last_seen_seq = seq_now;
            let Some(frame) = frame else { continue };

            send_frame(&mut conn, &shared, &frame, tolerance, &mut quantize_cache, &app, &key);
        }
    });
}

// diffs `frame` (addr, rgb pairs) against last_sent, quantizes if
// configured, sends only the pads that actually changed. marks the
// device disconnected on send failure.
fn send_frame(
    conn: &mut MidiOutputConnection,
    shared: &DeviceShared,
    frame: &[(u8, [u8; 3])],
    tolerance: u8,
    quantize_cache: &mut HashMap<u32, [u8; 3]>,
    app: &AppHandle,
    key: &str,
) {
    let tolerance = tolerance as i16;
    let quantize_cfg = shared.quantize.lock().unwrap();
    let mut last_sent = shared.last_sent.lock().unwrap();

    let mut pad_data = Vec::new();
    for (addr, rgb) in frame {
        let rgb = match quantize_cfg.as_ref() {
            Some(cfg) => quantize_rgb(*rgb, cfg, quantize_cache),
            None => *rgb,
        };

        let changed = match last_sent.get(addr) {
            Some(prev) => {
                (prev[0] as i16 - rgb[0] as i16).abs() > tolerance
                    || (prev[1] as i16 - rgb[1] as i16).abs() > tolerance
                    || (prev[2] as i16 - rgb[2] as i16).abs() > tolerance
            }
            None => true,
        };
        if !changed { continue; }

        last_sent.insert(*addr, rgb);
        pad_data.push(*addr);
        pad_data.extend_from_slice(&rgb);
    }
    drop(last_sent);
    drop(quantize_cfg);

    if pad_data.is_empty() { return; }

    for chunk in pad_data.chunks(MAX_PADS_PER_MESSAGE * 4) {
        let mut msg = Vec::with_capacity(SYSEX_HEADER.len() + chunk.len() + 1);
        msg.extend_from_slice(&SYSEX_HEADER);
        msg.extend_from_slice(chunk);
        msg.push(SYSEX_FOOTER);

        if conn.send(&msg).is_err() {
            mark_disconnected(shared, app, key);
            return;
        }
    }
}

fn mark_disconnected(shared: &DeviceShared, app: &AppHandle, key: &str) {
    if shared.connected.swap(false, Ordering::SeqCst) {
        let _ = app.emit("kinetic:device-disconnected", key);
    }
}

// ── batched push (one call per frame, all devices) ──────────────────

#[tauri::command]
pub fn kinetic_live_push_batch(
    state: tauri::State<Mutex<KineticLiveState>>,
    payload: Vec<u8>,
) {
    let guard = state.lock().unwrap();

    // payload = concat of [device_index_byte][r,g,b]*N per changed device.
    // device_index is the stable index returned by kinetic_live_connect,
    // NOT a position in any collection (see index_to_key/assign_index).
    let mut cursor = 0usize;
    while cursor < payload.len() {
        let device_index = payload[cursor];
        cursor += 1;

        let Some(key) = guard.index_to_key.get(&device_index) else { break };
        let Some(channel) = guard.devices.get(key) else { break };

        let pad_count = channel.addresses.len();
        let bytes_needed = pad_count * 3;
        if cursor + bytes_needed > payload.len() { break; }

        let slice = &payload[cursor..cursor + bytes_needed];
        cursor += bytes_needed;

        if !channel.shared.connected.load(Ordering::SeqCst) { continue; }

        let mut frame = Vec::with_capacity(pad_count);
        for (i, addr) in channel.addresses.iter().enumerate() {
            let base = i * 3;
            frame.push((*addr, [slice[base], slice[base + 1], slice[base + 2]]));
        }

        *channel.shared.pending.lock().unwrap() = Some(frame);
        channel.shared.seq.fetch_add(1, Ordering::Release);
        channel.shared.condvar.notify_one();
    }
}

// ── quantize toggle (rare command, not sent per-frame) ──────────────

#[tauri::command]
pub fn kinetic_live_set_quantize(
    state: tauri::State<Mutex<KineticLiveState>>,
    key: String,
    enabled: bool,
    palette: Option<Vec<[u8; 3]>>,
) -> Result<(), String> {
    let guard = state.lock().unwrap();
    let channel = guard.devices.get(&key).ok_or("Device not connected")?;
    let mut q = channel.shared.quantize.lock().unwrap();
    *q = if enabled {
        Some(QuantizeConfig { palette: palette.unwrap_or_default() })
    } else {
        None
    };
    Ok(())
}

// ── disconnect ───────────────────────────────────────────────────────

#[tauri::command]
pub fn kinetic_live_disconnect(state: tauri::State<Mutex<KineticLiveState>>, key: String) {
    let mut guard = state.lock().unwrap();
    stop_existing(&mut guard, &key);
    // index deliberately NOT freed/reused; a stale index in an in-flight
    // JS payload should silently miss (index_to_key lookup fails) rather
    // than ever be reassigned to a different device mid-session.
}

// ── background disconnect poll ──────────────────────────────────────
// midir has no reliable cross-platform "port unplugged" callback, so this
// periodically re-lists MIDI ports and marks any connected device whose
// port name has vanished as disconnected, even if nothing was being sent
// to it at the time (a failed send() also triggers this, see send_frame).

pub fn spawn_port_poll(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(PORT_POLL_INTERVAL);

        let live_ports: Vec<String> = match MidiOutput::new("aerolux-kinetic-poll") {
            Ok(out) => out.ports().iter().filter_map(|p| out.port_name(p).ok()).collect(),
            Err(_) => continue,
        };

        // re-fetched fresh each tick, same pattern llama_server.rs's
        // watch_health uses for background threads touching managed state.
        let state = app.state::<Mutex<KineticLiveState>>();
        let guard = state.lock().unwrap();
        for (key, channel) in guard.devices.iter() {
            if !channel.shared.connected.load(Ordering::SeqCst) { continue; }
            if !live_ports.contains(&channel.port_name) {
                mark_disconnected(&channel.shared, &app, key);
            }
        }
    });
}