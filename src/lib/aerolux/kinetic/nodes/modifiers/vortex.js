// src/lib/aerolux/kinetic/nodes/modifiers/vortex.js

import { ModifierField } from "../../field";
import { vortexForce } from "../../particlePhysics";

export function createVortexField(params, context, inputField, inputFieldB, resolveParam, integrateParam, instanceId) {
    const { centerX = 4.5, centerY = 4.5, strength = 12 } = params;
    return ModifierField('vortex', params, context, inputField, instanceId, ({ ownerId, inputField, resolution }) => ({
        ownerId, inputField, resolution,
        force: vortexForce({ centerX, centerY, strength }),
    }));
}