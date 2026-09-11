// src/lib/aerolux/kinetic/nodes/simulations/flocking.js
import { statefulField, colourCycleField } from '../../field.js';
import { resolveColourOrGradient, resolveCycleMode, resolveCycleOpts, createStepAccumulator, createParticleBuffer } from '../../sharedHelpers.js';

function hashToUnit(x, y, seed) {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
}

export function createFlockingField(params, context, inputField) {
    const {
        resolution = 9, count = 12, maxSpeed = 3,
        separationRadius = 1.5, separationStrength = 1.2,
        alignmentStrength = 0.6, cohesionStrength = 0.4,
        decay = 0.9, wrapEdges = true, seed = 0, stepsPerSecond = 20,
    } = params;

    const size = resolution + 1;
    const accumulator = createStepAccumulator(stepsPerSecond);
    const buffer = createParticleBuffer(resolution, decay);
    let boids = null;
    let spawnCursor = 0;

    function seedBoids() {
        boids = [];
        for (let i = 0; i < count; i++) {
            const a = hashToUnit(i, 0, seed) * Math.PI * 2;
            boids.push({
                x: hashToUnit(i, 1, seed) * size, y: hashToUnit(i, 2, seed) * size,
                vx: Math.cos(a) * maxSpeed * 0.5, vy: Math.sin(a) * maxSpeed * 0.5,
            });
        }
    }

    const shapeField = statefulField({},
        (state, dt, ctx) => {
            if (inputField?.kind === 'stateful') inputField.advance(dt, ctx);
            if (!boids) seedBoids();
            const steps = accumulator.tick(dt);
            const stepDt = 1 / Math.max(0.0001, stepsPerSecond);
            const t = ctx?.currentTick ?? 0;
            for (let s = 0; s < steps; s++) {
                buffer.decayStep();
                if (inputField) {
                    for (let gy = 0; gy < size; gy++) {
                        for (let gx = 0; gx < size; gx++) {
                            const lit = inputField.kind === 'stateful' ? inputField.sample(gx, gy) : inputField.sample(gx, gy, t);
                            if (!lit) continue;
                            const b = boids[spawnCursor % boids.length];
                            const a = hashToUnit(spawnCursor, t, seed) * Math.PI * 2;
                            b.x = gx; b.y = gy;
                            b.vx = Math.cos(a) * maxSpeed * 0.5; b.vy = Math.sin(a) * maxSpeed * 0.5;
                            spawnCursor++;
                        }
                    }
                }
                for (const b of boids) {
                    let sepX = 0, sepY = 0, aliX = 0, aliY = 0, cohX = 0, cohY = 0, neighbours = 0;
                    for (const o of boids) {
                        if (o === b) continue;
                        const dx = b.x - o.x, dy = b.y - o.y;
                        const dist = Math.hypot(dx, dy) || 0.0001;
                        if (dist < separationRadius) { sepX += dx / dist; sepY += dy / dist; }
                        if (dist < separationRadius * 3) {
                            aliX += o.vx; aliY += o.vy; cohX += o.x; cohY += o.y; neighbours++;
                        }
                    }
                    let ax = sepX * separationStrength, ay = sepY * separationStrength;
                    if (neighbours > 0) {
                        ax += (aliX / neighbours - b.vx) * alignmentStrength;
                        ay += (aliY / neighbours - b.vy) * alignmentStrength;
                        ax += (cohX / neighbours - b.x) * cohesionStrength * 0.1;
                        ay += (cohY / neighbours - b.y) * cohesionStrength * 0.1;
                    }
                    b.vx += ax * stepDt;
                    b.vy += ay * stepDt;
                    const mag = Math.hypot(b.vx, b.vy) || 0.0001;
                    if (mag > maxSpeed) { b.vx = (b.vx / mag) * maxSpeed; b.vy = (b.vy / mag) * maxSpeed; }
                    b.x += b.vx * stepDt;
                    b.y += b.vy * stepDt;
                    if (wrapEdges) {
                        b.x = ((b.x % size) + size) % size;
                        b.y = ((b.y % size) + size) % size;
                    } else {
                        b.x = Math.max(0, Math.min(size, b.x));
                        b.y = Math.max(0, Math.min(size, b.y));
                    }
                    buffer.deposit(b.x, b.y, 1);
                }
            }
        },
        (state, x, y) => buffer.read(x, y));

    const resolveColour = resolveColourOrGradient(params.colour, context);
    const cycleMode = resolveCycleMode(params.colour);
    return colourCycleField(shapeField, resolveColour, cycleMode, { resolution, ...resolveCycleOpts(params.colour) });
}