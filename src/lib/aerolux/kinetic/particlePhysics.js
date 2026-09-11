// src/lib/aerolux/kinetic/particlePhysics.js
// ============================================================================
// KINETIC ENGINE: PARTICLE PHYSICS CORE
// this is for any node that wants to apply physics-based transformations
//
// since this is a shared engine, nodes with this modifier are able to interact
// with one another. therefore, this behaviour has been split into two modes;
// a 'global' mode by default, and a 'type' mode. global mode means that any
// and every node with the same 'global' setting that uses this physics
// engine will interact with each other, and type mode means that only nodes
// of the same type will interact with each other.
// there is also individually assignable channels for the type mode so that
// different particle pools can exist and interact without affecting other
// particle pools.
//
// ============================================================================

export const DEFAULT_MAX_PARTICLES = 125; // should be enough for one device i think
export const HARD_MAX_PARTICLES = 250;    // more devices if needed

/**
    the stable group key a modifier instance's particles/forces belong to

@param {number|string} channel
@param {'type'|'global'} scope
@param {string} nodeType
@returns {string}
*/
export function groupKey(channel, scope, nodeType) {
    return `${channel}:${scope === 'global' ? 'global' : nodeType}`;
}

/**
    this creates an empty particle pool. one pool per group

@param {number} [maxParticles]
@returns {{particles: Map<string,Object>, maxParticles: number}}
*/
export function createParticlePool(maxParticles = DEFAULT_MAX_PARTICLES) {
    return {
        particles: new Map(), // seedKey -> particle
        maxParticles: Math.max(1, Math.min(HARD_MAX_PARTICLES, Math.round(maxParticles))),
    };
}

// self explanatory
export function sampleUpstream(field, x, y, t) {
    if (!field) return null;
    return field.kind === 'stateful' ? field.sample(x, y) : field.sample(x, y, t);
}

/**
    this function re-reads the colour for every particle that is still attached
    from its origin cell's current value on the upstream field

    a particle detaches and keeps its last colour forever after the moment either
    its origin cell goes dark or it has moved meaningfully off its origin cell

@param {{particles:Map}} pool
@param {Map<string, {field:Field|null, resolution:number}>} ownerFields
@param {number} t
*/
export function refreshAttachedColours(pool, ownerFields, t) {
    for (const p of pool.particles.values()) {
        if (!p.attached) continue;

        const moved = Math.round(p.x) !== p.ox || Math.round(p.y) !== p.oy;
        if (moved) { p.attached = false; continue; }

        const source = ownerFields.get(p.ownerId);
        const field = source?.field;
        if (!field) { p.attached = false; continue; }

        const rgb = field.kind === 'stateful' ? field.sample(p.ox, p.oy) : field.sample(p.ox, p.oy, t);
        if (!rgb) { p.attached = false; continue; }
        p.colour = rgb;
    }
}

/**
    this applies one force generator to every particle that is currently
    in the pool and mutates vx/vy only

@param {{particles:Map}} pool
@param {(particle:Object, dt:number) => {ax:number, ay:number}} forceFn
@param {number} dt
*/
export function applyForce(pool, forceFn, dt) {
    for (const p of pool.particles.values()) {
        const { ax, ay } = forceFn(p, dt);
        p.vx += ax * dt;
        p.vy += ay * dt;
    }
}

/**
    this integrates position from velocity, ages every particle and resolves
    bounds. 
    clamp holds a particle at the boundary and zeros the velocity, bounce
    reflects the velocity instead (as though it was a wall)
    bounds is the same as simulation nodes so that it doesnt become too
    performance heavy

@param {{particles:Map}} pool
@param {number} dt
@param {{minX:number,maxX:number,minY:number,maxY:number}} bounds
@param {'clamp'|'bounce'|'none'} edgeMode
@param {number} [restitution]  0-1, only used when edgeMode is bounce
*/
export function integrate(pool, dt, bounds, edgeMode = 'clamp', restitution = 0.6) {
    for (const p of pool.particles.values()) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.age += dt;

        if (edgeMode === 'none' || !bounds) continue;

        if (p.x < bounds.minX) { p.x = bounds.minX; p.vx = edgeMode === 'bounce' ? -p.vx * restitution : 0; }
        if (p.x > bounds.maxX) { p.x = bounds.maxX; p.vx = edgeMode === 'bounce' ? -p.vx * restitution : 0; }
        if (p.y < bounds.minY) { p.y = bounds.minY; p.vy = edgeMode === 'bounce' ? -p.vy * restitution : 0; }
        if (p.y > bounds.maxY) { p.y = bounds.maxY; p.vy = edgeMode === 'bounce' ? -p.vy * restitution : 0; }
    }
}

/**
    this does pairwise elastic-esque collision resolution across the whole pool.
    this is why every pool has a hard-limit of the max. no of particles (O(n^2))

    two particles that are closer than the diameter get pushed apart along the
    contact normal and have their velocities exchanged (scaled by restitution). 
    since particles in aerolux are assumed to be scalar points without mass, 
    this remains mostly elastic (and also lightweight instead of having proper 
    physics solving)

@param {{particles:Map}} pool
@param {number} radius
@param {number} [restitution]
*/
export function resolveCollisions(pool, radius, restitution = 0.7) {
    const list = [...pool.particles.values()];
    const minDist = radius * 2;

    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= 0 || dist >= minDist) continue;

            const nx = dx / dist, ny = dy / dist;
            const overlap = minDist - dist;

            // separate half each along the contact normal
            a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
            b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;

            // exchange the velocity component along the normal (equal-mass
            // elastic approximation)
            // scaled by restitution as mentioned
            const avn = a.vx * nx + a.vy * ny;
            const bvn = b.vx * nx + b.vy * ny;
            const diff = (bvn - avn) * restitution;
            a.vx += diff * nx; a.vy += diff * ny;
            b.vx -= diff * nx; b.vy -= diff * ny;
        }
    }
}

/**
    this removes particles owned by `ownerId` that is older than `maxAge`, or
    whose colour has decayed below visibility if a decay curve is
    supplied (potential future extention).
    earlier it was mentioned in a previous function that a node has to opt-in
    to a function if it wants to despawn a particle. this is that function

@param {{particles:Map}} pool
@param {string} ownerId
@param {number} maxAge in seconds
*/
export function retireAged(pool, ownerId, maxAge) {
    for (const [key, p] of pool.particles) {
        if (p.ownerId === ownerId && p.age >= maxAge) pool.particles.delete(key);
    }
}

/**
    this rasterises only the particles belonging to one owner in a lookup map.
    through this performance can be kept under control. also it helps to return
    back to the field output that's required after every node type regardless
    of type or function, even after its physics are shaped by the whole group.

@param {{particles:Map}} pool
@param {string} ownerId
@returns {Map<string,[number,number,number]>}
*/
export function rasterizeOwner(pool, ownerId) {
    const frame = new Map();
    for (const p of pool.particles.values()) {
        if (p.ownerId !== ownerId) continue;
        frame.set(`${Math.round(p.x)},${Math.round(p.y)}`, p.colour);
    }
    return frame;
}

// force generator factories ––––––––––––––––––––––––––––––––––––––––
// each returns a (particle, dt) -> {ax, ay} function for applyForce.


/**
    this provides a constant directional acceleration
    - gravity uses this in the downwards direction
    - wind uses this in an arbirtrary angle that can be optionally gusted

@param {{accel:number, directionRad:number, gust?:number}} opts
*/
export function constantForce({ accel, directionRad, gust = 0 }) {
    const dirX = Math.cos(directionRad), dirY = Math.sin(directionRad);
    return (particle, dt) => {
        const g = gust > 0 ? 1 + (Math.sin(particle.age * 3.7 + particle.x * 1.3) * gust) : 1;
        return { ax: dirX * accel * g, ay: dirY * accel * g };
    };
}

/** 
    air resistance (velocity-proportional drag)
    the coefficient is per-second decay strength
*/
export function dragForce({ coefficient }) {
    return (particle) => ({ ax: -particle.vx * coefficient, ay: -particle.vy * coefficient });
}

/** 
    tangential force around a centre point
    positive strength is clockwise    
*/
export function vortexForce({ centerX, centerY, strength }) {
    return (particle) => {
        const dx = particle.x - centerX, dy = particle.y - centerY;
        const dist = Math.max(0.001, Math.hypot(dx, dy));
        // Perpendicular to the radius vector.
        return { ax: (-dy / dist) * strength, ay: (dx / dist) * strength };
    };
}

/**
    this is a single-point radial force 
    positive strength attracts towards the origin, negative repels.
    for falloff:
    - linear divides by distance
    - inverseSquare divides by distance^2 (clamped to avoid singularities)
*/
export function radialForce({ originX, originY, strength, falloff = 'inverseSquare' }) {
    return (particle) => {
        const dx = originX - particle.x, dy = originY - particle.y;
        const dist = Math.max(0.15, Math.hypot(dx, dy));
        const denom = falloff === 'linear' ? dist : dist * dist;
        const mag = strength / denom;
        return { ax: (dx / dist) * mag, ay: (dy / dist) * mag };
    };
}

/**
    two-pole dipole force like a magnet's poles 
    a positive pole and a negative pole sit at +-poleGap/2 along the axis 
    defined by poleAngle, both centred on (originX, originY). 
    net force is the sum of two radial forces
 */
export function dipoleForce({ originX, originY, poleAngle, poleGap, strength, falloff = 'inverseSquare' }) {
    const dirX = Math.cos(poleAngle), dirY = Math.sin(poleAngle);
    const half = poleGap / 2;
    const posPole = { x: originX + dirX * half, y: originY + dirY * half };
    const negPole = { x: originX - dirX * half, y: originY - dirY * half };

    const pull = radialForce({ originX: posPole.x, originY: posPole.y, strength: Math.abs(strength), falloff });
    const push = radialForce({ originX: negPole.x, originY: negPole.y, strength: -Math.abs(strength), falloff });

    return (particle, dt) => {
        const a = pull(particle, dt);
        const b = push(particle, dt);
        return { ax: a.ax + b.ax, ay: a.ay + b.ay };
    };
}

/**
    yet another random seed generator. how many does this codebase have now
    used for impulse

@param {{strength:number, spread?:number, seed?:number}} opts
@returns {(x:number,y:number)=>{vx:number,vy:number}}
*/
export function randomImpulse({ strength, spread = 1, seed = 0 }) {
    return (x, y) => {
        const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
        const angle = (h - Math.floor(h)) * Math.PI * 2;
        const mag = strength * (0.5 + 0.5 * spread * ((Math.sin(h * 2) + 1) / 2));
        return { vx: Math.cos(angle) * mag, vy: Math.sin(angle) * mag };
    };
}

/**
    this function is to fix the issue of particles being considered 'active'
    despite going dark or off-screen, which can lead to any new input particle
    not being affected or passed-through making the canvas look frozen.

    for each group there is a live particle budget. each currently-enabled
    device has a fixed allowance of 100 buttons, summed then clamped by the
    node's own maxParticles.

@param {Array<{enabled:boolean}>} devices
@param {number} configuredMax
*/
export function computeLiveCap(devices, configuredMax) {
    const enabledCount = Math.max(1, devices?.filter(d => d.enabled).length ?? 1);
    return Math.max(1, Math.min(HARD_MAX_PARTICLES, configuredMax, enabledCount * 98));
}

/**
    this checks if a canvas-space point falls inside any enabled device's
    actual footprint (including rotation)

@param {number} x
@param {number} y
@param {Array<{position:{x,y}, rotation:number, enabled:boolean}>} devices
*/
export function isCanvasPointVisible(x, y, devices) {
    for (const device of devices ?? []) {
        if (!device.enabled) continue;
        const dx = x - device.position.x, dy = y - device.position.y;
        let lx, ly;
        switch (device.rotation) {
            case 90:  lx = dy; ly = -dx; break;
            case 180: lx = -dx; ly = -dy; break;
            case 270: lx = -dy; ly = dx; break;
            default:  lx = dx; ly = dy; break;
        }
        if (lx >= -0.5 && lx <= 9.5 && ly >= -0.5 && ly <= 9.5) return true;
    }
    return false;
}

// this marks a new particle's canvas-space home position, done by placing
// the local seed coordinate through the first enabled device's placement
function stampCanvasPosition(localX, localY, devices) {
    const device = (devices ?? []).find(d => d.enabled) ?? { position: { x: 0, y: 0 }, rotation: 0 };
    const dx = localX - 4.5, dy = localY - 4.5;
    let rx, ry;
    switch (device.rotation) {
        case 90:  rx = -dy; ry = dx; break;
        case 180: rx = -dx; ry = -dy; break;
        case 270: rx = dy; ry = -dx; break;
        default:  rx = dx; ry = dy; break;
    }
    return { x: rx + 4.5 + device.position.x, y: ry + 4.5 + device.position.y };
}

/**
    this samples an upstream field over a fixed local grid and spawns a particle
    for every newly-lit cell that this owner hasn't seeded yet. but this does
    not despawn the particle because that is the node's job to opt-in to a function
    established later

    unlike other "seed from" functions (stateful), this remembers the origin position of the 
    particles along with an 'attached' flag so it can track the live colour of the particle
    while being modified

    if the pool is at capacity when a new particle wants to spawn, the particle
    that has been out of bounds for the longest time is evicted to make room, and
    if every existing particle is visible, the new spawn is skipped

@param {{particles:Map, maxParticles:number}} pool
@param {string} ownerId (instanceId)
@param {import('./field.js').Field|null} field
@param {number} resolution
@param {number} t
@param {Array} devices (active)
@param {number} liveCap
@param {(x:number,y:number)=>{vx:number,vy:number}} [initialVelocity] optional per-spawn impulse but default is rest
@returns {number} how many new particles were actually spawned
*/
export function seedFromField(pool, ownerId, field, resolution, t, devices, liveCap, initialVelocity) {
    if (!field) return 0;
    let spawned = 0;

    for (let y = 0; y <= resolution; y++) {
        for (let x = 0; x <= resolution; x++) {
            const seedKey = `${ownerId}:${x},${y}`;
            if (pool.particles.has(seedKey)) continue;

            const rgb = field.kind === 'stateful' ? field.sample(x, y) : field.sample(x, y, t);
            if (!rgb) continue;

            if (pool.particles.size >= liveCap) {
                const evicted = evictLongestInvisible(pool, devices);
                if (!evicted) continue;
            }

            const canvasPos = stampCanvasPosition(x, y, devices);
            const impulse = initialVelocity ? initialVelocity(x, y) : { vx: 0, vy: 0 };
            pool.particles.set(seedKey, {
                ownerId,
                x: canvasPos.x, y: canvasPos.y,
                vx: impulse.vx, vy: impulse.vy,
                ox: x, oy: y,
                colour: rgb,
                attached: true,
                invisibleSince: null,
                age: 0,
            });
            spawned++;
        }
    }
    return spawned;
}

/**
    this evicts the particle that has been out of bounds the longest

@param {{particles:Map}} pool
@param {Array} devices
*/
function evictLongestInvisible(pool, devices) {
    let oldestKey = null, oldestSince = Infinity;
    for (const [key, p] of pool.particles) {
        if (p.invisibleSince != null && p.invisibleSince < oldestSince) {
            oldestSince = p.invisibleSince;
            oldestKey = key;
        }
    }
    if (oldestKey == null) return false;
    pool.particles.delete(oldestKey);
    return true;
}

/**
    this updates each particle's invisibleSince every tick to factor for
    particles that re-enter an active device; sets it back to 0 so it
    doesnt randomly vanish if its in the frame after leaving the bounds
    a long time ago

@param {{particles:Map}} pool
@param {Array} devices
@param {number} t
*/
export function updateVisibility(pool, devices, t) {
    for (const p of pool.particles.values()) {
        const visible = isCanvasPointVisible(p.x, p.y, devices);
        if (visible) {
            p.invisibleSince = null;
        } else if (p.invisibleSince == null) {
            p.invisibleSince = t;
        }
    }
}