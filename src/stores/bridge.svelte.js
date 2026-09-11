// src/stores/bridge.svelte.js
// this is a reactive wrapper around lib/bridge/client.js
// it owns connection status that BridgePanel.svelte reads

import * as bridgeClient from '../lib/aerolux/bridge/client.js';
import { MESSAGE_TYPES } from '../lib/aerolux/bridge/protocol.js';
import * as preview from '../lib/aerolux/bridge/preview.js';

export const bridge = $state({
    connected: false,
    lastError: null,
    transport: { bpm: 120, beat: 0, playing: false, loop: { enabled: false, start: 0, length: 0 } },
    preview: { active: false, effectId: null, localBeat: 0 },
});

let started = false;

export async function connectBridge() {
    if (started) return;
    started = true;

    bridgeClient.onStatusChange(({ connected, reason }) => {
        bridge.connected = connected;
        if (!connected && reason) bridge.lastError = reason;
    });

    bridgeClient.onMessage((msg) => {
        if (msg.type === MESSAGE_TYPES.PREVIEW_BEGIN) {
            const result = preview.beginPreview(msg.payload.effectID, msg.payload.absoluteBeat, msg.payload.effectStartBeat);
            bridge.preview = { active: true, effectId: result.effectId, localBeat: result.localBeat };
        }
        if (msg.type === MESSAGE_TYPES.PREVIEW_POSITION) {
            const result = preview.onPreviewPosition(msg.payload.beat ?? msg.payload.localBeat);
            if (result) bridge.preview.localBeat = result.localBeat;
        }
        if (msg.type === MESSAGE_TYPES.PREVIEW_END) {
            preview.endPreview();
            bridge.preview = { active: false, effectId: null, localBeat: 0 };
        }
    });

    await bridgeClient.startBridge();
}

export async function disconnectBridge() {
    await bridgeClient.stopBridge();
    started = false;
    bridge.connected = false;
}