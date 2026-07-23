// src/lib/aerolux/kinetic/nodes/generators/waveform.js
// a sine/triangle/square wave sweeps across the canvas as a brightness modulation.

// differs from sweep but might be reworked to actually display a waveform rather than sending it as a brightness modulatior.

import { resolvePaletteColour, clamp63 } from "../../sharedHelpers";

function waveShape(type, phase01) {
    switch (type) {
        case 'triangle': return phase01 < 0.5 ? phase01 * 2 : (1 - phase01) * 2;
        case 'square':   return phase01 < 0.5 ? 1 : 0;
        default:         return (Math.sin(2 * Math.PI * phase01) + 1) / 2;
    }
}

export function createWaveformField(params, context, inputField, inputFieldB, resolveParam, integrateParam) {
    const {
        angleDegrees = 0,
        frequency    = 0.3,     // cycles per canvas unit
        waveType     = 'sine',  // 'sine' | 'triangle' | 'square'
        amplitude    = 1,       // 0-1 modulation depth
        colourIdx    = 8,
    } = params;

    const rgb = resolvePaletteColour(context?.palette, colourIdx);
    const rad = angleDegrees * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = Math.sin(rad);

    return {
        kind: 'stateless',
        sample(x, y, t) {
            const pos = x * dirX + y * dirY;
            const offset = integrateParam
                ? integrateParam('speed', t)
                : (params.speed ?? 0.05) * t;
            let phase = ((pos - offset) * frequency) % 1;
            if (phase < 0) phase += 1;
            const wave = waveShape(waveType, phase);
            const brightness = 1 - amplitude + amplitude * wave;
            return rgb.map(v => clamp63(v * brightness));
        },
    };
}