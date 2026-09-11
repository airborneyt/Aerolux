// src/lib/aerolux/audio/index.js
// this is where everything in aerolux that is sound-related should 
// be imported from. everthing else in this folder is implementation
// systems that support this engine.
//
// not to be confused with the potential aerolux audio engine, auralux
//
// usage:
//
//   import { audio } from '$lib/aerolux/audio';
//
//   audio.init();
//   audio.setVolume('sfx', 0.9);
//   audio.getState();
//   audio.on('error', (err) => showToast(err.message, 'error'));
//
//   audio.sfx.play('node_snap');
//   audio.ost.enable();

import * as engine from './engine.svelte.js';
import * as sfx from './sfx/manager.js';
import * as ost from './ost/manager.svelte.js';

export const audio = {
    init: engine.init,

    /** @param {'master'|'ost'|'sfx'|'notifications'} bus @param {number} value 0-1 */
    setVolume: engine.setVolume,
    previewVolume: engine.previewVolume,
    setEnabled: engine.setSoundEnabled,

    getState: engine.getState,

    /** @param {'stateChanged'|'error'} event */
    on: engine.on,

    // SFX ––––––––––––––––––––––––––––––––––––––––––––––––
    sfx: {
        play: sfx.play,
        stop: sfx.stop,
        update: sfx.update,
    },

    // OST ––––––––––––––––––––––––––––––––––––––––––––––––
    ost: {
        enable: ost.enable,
        disable: ost.disable,
    },
};

// if there is a future diagnostics page
export { audioState } from './state.svelte.js';
export { AudioError, AudioErrorType } from './errors.js';