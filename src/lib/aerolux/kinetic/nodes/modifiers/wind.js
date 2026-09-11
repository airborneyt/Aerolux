// src/lib/aerolux/kinetic/nodes/modifiers/wind.js

import { ModifierField } from "../../field";
import { constantForce } from "../../particlePhysics";

export function createWindField(params, context, inputField, inputFieldB, resolveParam, integrateParam, instanceId) {
    const { strength = 15, directionDeg = 0, gust = 0.3 } = params;
    return ModifierField('wind', params, context, inputField, instanceId, ({ ownerId, inputField, resolution }) => ({
        ownerId, inputField, resolution,
        force: constantForce({ accel: strength, directionRad: directionDeg * Math.PI / 180, gust }),
    }));
}