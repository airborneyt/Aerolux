// src/lib/aerolux/api.js
// the API for Aerolux is created here
// returns utility functions for gradients (as of now) to be used by plugin devs in the future

export function createEventEmitter() {
    let listeners = [];

    function on(event, handler) {
        const listener = { event, handler };
        listeners.push(listener);

        return function unsubscribe() {
            listeners = listeners.filter(l => l !== listener);
        }
    }

    function emit(event, data) {
        listeners.forEach(function(listener) {
            if (listener.event === event) {
                listener.handler(data);
            }
        })
    }

    function once(event, handler) {
        let unsubscribe
        function wrapper(data) {
            handler(data);
            unsubscribe();
        }
        unsubscribe = on(event, wrapper);
        return unsubscribe;
    }

    return { on, emit, once };
}

export function createAeroluxAPI(store, gradResult, history, emitter, utils, colourTools) {
    const { pushUndo, undo, redo, undoState } = history
    const { toHSL, hslToRgb63, findNearest } = colourTools;
    let installedPlugins = []
    return {
        read: {
            getStops() {
                return store.stops;
            },
            getAlgorithm() {
                return store.algorithm;
            },
            getHslDir() {
                return store.hslDir;
            },
            getEasing() {
                return store.easing;
            },
            getSteps() {
                return store.steps;
            },
            getTint() {
                return store.tint;
            },
            getEnvelope() {
                return store.envelope;
            },
            getHueShift() {
                return store.hueShift;
            },
            getPalette() {
                return store.palette;
            },
            getResult() {
                return gradResult();
            },
            getState() {
                const snapshot = {
                    stops: store.stops,
                    algorithm: store.algorithm,
                    hslDir: store.hslDir,
                    easing: store.easing,
                    steps: store.steps,
                    tint: store.tint,
                    envelope: store.envelope,
                    hueShift: store.hueShift,
                    palette: store.palette,
                    result: gradResult(),
                };
                return snapshot;
            },
            getAntiRepeat() {
                return store.antiRepeat;
            }
        },
        gradient: {
            setStops(value) {
                pushUndo();
                store.stops = value;
            },
            setAlgorithm(value) {
                pushUndo();
                store.algorithm = value;
            },
            setHslDir(value) {
                pushUndo();
                store.hslDir = value;
            },
            setEasing(value) {
                pushUndo();
                store.easing = value;
            },
            setSteps(value) {
                pushUndo();
                store.steps = value;
            },
            setTint(value) {
                pushUndo();
                store.tint = value;
            },
            setEnvelope(value) {
                pushUndo();
                store.envelope = value;
            },
            setHueShift(value) {
                pushUndo();
                store.hueShift = value;
            },
            reverse() {
               pushUndo();
               store.stops = store.stops.map(s => ({ ...s, pos:1-s.pos }));
               store.stops.sort((a,b) => a.pos - b.pos);
            },
            randomise() {
                pushUndo()
                const count = 2 + Math.floor(Math.random() * 7)
                store.stops = Array.from({ length: count }, (_, i) => ({
                    id: store.nextId++,
                    pos: i === 0 ? 0 : i === count - 1 ? 1 : Math.random(),
                    ci: 1 + Math.floor(Math.random() * (store.palette.length - 1)),
                }))
                store.stops.sort((a, b) => a.pos - b.pos)
                store.selStop = store.stops[0].id
            },
            invert() {
                pushUndo()
                store.stops = store.stops.map(stop => {
                const c = store.palette[stop.ci] || store.palette[0];
                const {h, s, l} = colourTools.toHSL(c.r, c.g, c.b);
                const compH = (h + 0.5) % 1.0;
                const compRgb = colourTools.hslToRgb63(compH, s, l);
                const nearestCi = colourTools.findNearest(compRgb, store.palette, 'rgb');
                return { ...stop, ci: nearestCi};
                });
            },
            setAntiRepeat(value) {
                pushUndo();
                store.antiRepeat = value;
            }
        },
        history: {
            undo,
            redo,
            get canUndo() { return undoState.canUndo },
            get canRedo() { return undoState.canRedo },
        },
        on: emitter.on,
        once: emitter.once,

        export: {
            gradient: {
                toText() {
                    return utils.gradToText(gradResult());
                },
                toFilename() {
                    return gradResult().map(v => v.velocity).join('');
                },
                download() {
                    const text = utils.gradToText(gradResult());
                    const filename = gradResult().map(v => v.velocity).join('') + '.txt';
                    utils.downloadText(text, filename)
                }
            },
            effect: {
                toMidi() { throw new Error('Aerolux: effect export not yet implemented') },
                download() { throw new Error('Aerolux: effect export not yet implemented') }
            },
        },
        plugins: {
            register(plugin) {
                const existing = installedPlugins.find(p => p.name === plugin.name);
                if (existing) {
                    throw new Error(`Aerolux: plugin with name "${plugin.name}" is already registered`);
                };
                try {
                    plugin.install();
                    installedPlugins.push(plugin);
                    return { ok: true };
                } catch (err) {
                    console.error(`Aerolux: plugin "${plugin.name}" failed to install:`, err);
                    return { ok: false, reason: `Could not install plugin.` };
                }
            },
            unregister(name) {
                const existing = installedPlugins.find(p => p.name === name);
                if (!existing) {
                    return { ok: false, error: `Aerolux: plugin with name "${name}" does not exist` };
                };
                try {
                    existing.uninstall();
                    installedPlugins = installedPlugins.filter(p => p.name !== name);
                    return { ok: true };
                } catch (err) {
                    console.error(`Aerolux: plugin "${name}" failed to uninstall:`, err);
                    return { ok: false, reason: `Could not uninstall plugin.` };
                }
            },
            list() {
                const exposed = installedPlugins.map(p => ({ name: p.name, version: p.version, description: p.description, author: p.author }));
                return exposed;
            }
        }
    }
}