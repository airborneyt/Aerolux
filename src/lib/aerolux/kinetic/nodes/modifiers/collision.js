// src/lib/aerolux/kinetic/nodes/modifiers/collision.js

import { ensureChannelGroups, localGridBounds, registerGroupMember, stepGroup } from "../../channelSimulation";
import { groupKey, rasterizeOwner, sampleUpstream } from "../../particlePhysics";

export function createCollisionField(params, context, inputField, inputFieldB, resolveParam, integrateParam, instanceId) {
    const { radius = 0.4, restitution: bounceRestitution = 0.7 } = params;
    const { channel = 0, scope = 'type', resolution = 9, maxParticles = 100,
            edgeMode = 'none', restitution = 0.6, startTick = 0 } = params;

    const channelGroups = ensureChannelGroups(context);
    const bounds = localGridBounds(resolution);
    const groupCacheKey = groupKey(channel, scope, 'collision');
    let lastTick = 0;

    return {
        kind: 'stateful',
        advance(dt, ctx) {
            const t = ctx?.currentTick ?? 0;
            lastTick = t;
            if (t < startTick) return;

            const member = {
                ownerId: instanceId, inputField, resolution,
                collision: { radius, restitution: bounceRestitution },
            };
            const group = registerGroupMember(channelGroups, channel, scope, 'collision', member, maxParticles);
            stepGroup(group, dt, ctx?._physicsStep ?? 0, bounds, edgeMode, restitution, ctx?.currentTick ?? 0, context.devices);
        },
        sample(x, y) {
            if (lastTick < startTick) return sampleUpstream(inputField, x, y, lastTick);
            const group = channelGroups.get(groupCacheKey);
            if (!group) return null;
            return rasterizeOwner(group.pool, instanceId).get(`${Math.round(x)},${Math.round(y)}`) ?? null;
        },
    };
}