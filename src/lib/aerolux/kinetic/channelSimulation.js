// src/lib/aerolux/kinetic/channelSimulation.js
// ============================================================================
// KINETIC ENGINE: CHANNEL/GROUP SIMULATION
// this is used for the per-channel associated interaction now present in 
// the new modifier nodes. this is how the order of things happen in within
// one tick for one group:
//
// 1. seed:         every member owner spawns new particles from its upstream input into
//                  the shared pool.
// 2. force:        every member's force generator is applied once to the whole pool.
//                  this is what makes co-simulation function.
// 3. integrate:    advances the positions or the ages and resolves bounds
// 4. collide:      if any member in the group is a collision node, pairwise resolution
//                  runs once against the whole pool.
// 5. retire:       any member that has opted into ageing-out despawns its own
//                  expired particles.
//
// ============================================================================

import {
    createParticlePool, groupKey, seedFromField, applyForce,
    integrate, resolveCollisions, retireAged, refreshAttachedColours,
    computeLiveCap, updateVisibility
} from './particlePhysics.js';

/**
    this just makes sure that context.channelGroups exists
    if it doesnt, it creates one

@param {Object} context
@returns {Map<string, GroupState>}
*/
export function ensureChannelGroups(context) {
    if (!context.channelGroups) context.channelGroups = new Map();
    return context.channelGroups;
}

export function registerGroupMember(channelGroups, channel, scope, nodeType, member, maxParticles) {
    const key = groupKey(channel, scope, nodeType);
    let group = channelGroups.get(key);
    if (!group) {
        group = { pool: createParticlePool(maxParticles), members: [] };
        channelGroups.set(key, group);
    }
    group.members = group.members.filter(m => m.ownerId !== member.ownerId);
    group.members.push(member);
    return group;
}

/**
    this is for when a modifier node wants to opt into hard walls,
    and it can specify its own wallBounds param.

@param {{minX:number,maxX:number,minY:number,maxY:number}|null} wallBounds
*/
export function resolveBounds(wallBounds) {
    return wallBounds ?? null;
}

/**
    runs one full seed -> refresh -> force -> integrate -> track visibility -> collide -> retire cycle for one group
    safeguarded so that subsequent advance calls in the same tick are considered as one
    in case multiple members of the group try to trigger this at the same time

@param {GroupState} group
@param {number} dt
@param {number} stepId
@param {{minX:number,maxX:number,minY:number,maxY:number}} bounds
@param {'clamp'|'bounce'|'none'} edgeMode
@param {number} edgeRestitution
@param {number} t
*/
export function stepGroup(group, dt, stepId, bounds, edgeMode = 'clamp', edgeRestitution = 0.6, t = 0, devices = []) {
    if (group._lastStepRun === stepId) return;
    group._lastStepRun = stepId;

    const liveCap = computeLiveCap(devices, group.pool.maxParticles);

    // 1. seed: every member spawns its own new particles
    for (const m of group.members) {
        seedFromField(group.pool, m.ownerId, m.inputField, m.resolution, t, devices, liveCap, m.initialVelocity);
    }

    // 2. refresh colour for every still-attached particle
    const ownerFields = new Map(group.members.map(m => [m.ownerId, { field: m.inputField }]));
    refreshAttachedColours(group.pool, ownerFields, t);

    // 3. force: every member with a force contributes to the whole pool
    for (const m of group.members) if (m.force) applyForce(group.pool, m.force, dt);

    // 4. integrate
    integrate(group.pool, dt, bounds, edgeMode, edgeRestitution);

    // 5. visbility bookkeeping
    updateVisibility(group.pool, devices, t);

    // 6. collide: only if a member in the group is a collision node
    const collider = group.members.find(m => m.collision);
    if (collider) resolveCollisions(group.pool, collider.collision.radius, collider.collision.restitution);

    // 7. retire: each opted-in member despawns its own particles
    for (const m of group.members) {
        if (m.retireAfter != null) retireAged(group.pool, m.ownerId, m.retireAfter);
    }
}

export function localGridBounds(resolution) {
    return { minX: 0, maxX: resolution, minY: 0, maxY: resolution };
}