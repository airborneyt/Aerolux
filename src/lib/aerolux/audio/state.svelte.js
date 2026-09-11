// src/lib/aerolux/audio/state.svelte.js
//
// this is a read-only snapshot for components to react to.
// the only component that is able to mutate anything in this file
// is engine.svelte.js

export const audioState = $state({
    ready: false,

    context: {
        state: /** @type {'closed'|'suspended'|'running'} */ ('closed'),
    },

    // mirrors settings.sound, but this is the live effective view 
    // (what's actually applied to the graph right now)
    volumes: {
        master: 1,
        ost: 1,
        sfx: 1,
        notifications: 1,
    },
    enabled: true,

    // 'active' | 'background' | 'minimised' | 'recovering'
    activity: 'active',

    // OST diagnostic block
    ost: {
        enabled: true,
        pack: null,
        track: null,
        position: 0,
        duration: 0,
        hour: null,
        transitionAt: null,
        state: /** @type {'idle'|'loading'|'playing'|'fading'} */ ('idle'),
    },
});

// engine-only setters ––––––––––––––––––––––––––––––––––––––––––––––

export function setReady(ready) {
    audioState.ready = ready;
}

export function setContextState(state) {
    audioState.context.state = state;
}

export function setVolumeSnapshot(volumes) {
    Object.assign(audioState.volumes, volumes);
}

export function setEnabled(enabled) {
    audioState.enabled = enabled;
}

export function setActivity(activity) {
    audioState.activity = activity;
}

export function setOstSnapshot(patch) {
    Object.assign(audioState.ost, patch);
}