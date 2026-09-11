// src/lib/aerolux/kinetic/nodes/modifiers/explode.js

import { ensureChannelGroups, localGridBounds, registerGroupMember, stepGroup } from "../../channelSimulation";
import { groupKey, dragForce, rasterizeOwner, sampleUpstream } from "../../particlePhysics";

export function createExplodeField(params, context, inputField, inputFieldB, resolveParam, integrateParam, instanceId) {
    const {
        originX = 4.5, originY = 4.5, impulseStrength = 30, triggerTick = 0,
        lifespan = 2, decay = 0.9,
        channel = 0, scope = 'type', resolution = 9, maxParticles = 100,
        edgeMode = 'none', restitution = 0.5,
    } = params;

    const channelGroups = ensureChannelGroups(context);
    const bounds = localGridBounds(resolution);
    const groupCacheKey = groupKey(channel, scope, 'explode');
    let triggered = false;
    let lastTick = 0;

    return {
        kind: 'stateful',
        advance(dt, ctx) {
            const t = ctx?.currentTick ?? 0;
            lastTick = t;
            const shouldSeedNow = !triggered && t >= triggerTick;
            if (!shouldSeedNow && !triggered) return;

            const member = {
                ownerId: instanceId,
                inputField: shouldSeedNow ? inputField : null,
                resolution,
                initialVelocity: shouldSeedNow ? (x, y) => {
                    const dx = x - originX, dy = y - originY;
                    const dist = Math.max(0.15, Math.hypot(dx, dy));
                    return { vx: (dx / dist) * impulseStrength, vy: (dy / dist) * impulseStrength };
                } : undefined,
                force: dragForce({ coefficient: 1 - decay }),
                retireAfter: lifespan,
            };
            if (shouldSeedNow) triggered = true;

            const group = registerGroupMember(channelGroups, channel, scope, 'explode', member, maxParticles);
            stepGroup(group, dt, ctx?._physicsStep ?? 0, bounds, edgeMode, restitution, t, context.devices);
        },
        sample(x, y) {
            if (!triggered) return sampleUpstream(inputField, x, y, lastTick);
            const group = channelGroups.get(groupCacheKey);
            if (!group) return null;
            return rasterizeOwner(group.pool, instanceId).get(`${Math.round(x)},${Math.round(y)}`) ?? null;
        },
    };
}