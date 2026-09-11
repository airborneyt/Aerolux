// src/lib/aerolux/kinetic/nodes/modifiers/atomise.js

import { ModifierField } from "../../field";
import { randomImpulse } from "../../particlePhysics";

export function createAtomiseField(params, context, inputField, inputFieldB, resolveParam, integrateParam, instanceId) {
    const { kickStrength = 4, spread = 1, lifespan = 1.2, seed = 0 } = params;
    return ModifierField('atomise', params, context, inputField, instanceId, ({ ownerId, inputField, resolution }) => ({
        ownerId, inputField, resolution,
        initialVelocity: randomImpulse({ strength: kickStrength, spread, seed }),
        retireAfter: lifespan,
    }));
}