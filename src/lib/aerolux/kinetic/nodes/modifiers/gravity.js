// src/lib/aerolux/kinetic/nodes/modifiers/gravity.js

import { ModifierField } from "../../field";
import { constantForce } from "../../particlePhysics";

export function createGravityField(params, context, inputField, inputFieldB, resolveParam, integrateParam, instanceId) {
    const { accel = 20, directionDeg = 90 } = params;
    return ModifierField('gravity', params, context, inputField, instanceId, ({ ownerId, inputField, resolution }) => ({
        ownerId, inputField, resolution,
        force: constantForce({ accel, directionRad: directionDeg * Math.PI / 180 }),
    }));
}
