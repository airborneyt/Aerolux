// src/lib/aerolux/kinetic/nodes/modifiers/drag.js

import { ModifierField } from "../../field";
import { dragForce } from "../../particlePhysics";

export function createDragField(params, context, inputField, inputFieldB, resolveParam, integrateParam, instanceId) {
    const { coefficient = 0.8 } = params;
    return ModifierField('drag', params, context, inputField, instanceId, ({ ownerId, inputField, resolution }) => ({
        ownerId, inputField, resolution,
        force: dragForce({ coefficient }),
    }));
}