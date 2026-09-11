// src/lib/aerolux/kinetic/nodes/modifiers/magnetic.js

import { ModifierField } from "../../field";
import { dipoleForce, radialForce } from "../../particlePhysics";


export function createMagneticField(params, context, inputField, inputFieldB, resolveParam, integrateParam, instanceId) {
    const {
        mode = 'point', // 'point' | 'poles'
        originX = 4.5, originY = 4.5,
        strength = 25, falloff = 'inverseSquare',
        polarity = 'attract', // 'attract' | 'repel' (only in point mode)
        poleAngleDeg = 0, poleGap = 4, // poles mode only
    } = params;

    const force = mode === 'poles'
        ? dipoleForce({ originX, originY, poleAngle: poleAngleDeg * Math.PI / 180, poleGap, strength, falloff })
        : radialForce({ originX, originY, strength: polarity === 'repel' ? -strength : strength, falloff });

    return ModifierField('magnetic', params, context, inputField, instanceId, ({ ownerId, inputField, resolution }) => ({
        ownerId, inputField, resolution, force,
    }));
}