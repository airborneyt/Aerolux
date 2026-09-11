// src/lib/aerolux/kinetic/nodes/simulations/attractor.js
import { statefulField, colourCycleField } from '../../field.js';
import { resolveColourOrGradient, resolveCycleMode, resolveCycleOpts, createStepAccumulator, createParticleBuffer } from '../../sharedHelpers.js';

function hashToUnit(x, y, seed) {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
}

export function createAttractorField(params, context, inputField) {
    const {
        originX = 4.5, originY = 4.5, resolution = 9, count = 16,
        strength = 8, damping = 0.9, decay = 0.92, seed = 0, stepsPerSecond = 30,
    } = params;

    const size = resolution + 1;
    const accumulator = createStepAccumulator(stepsPerSecond);
    const buffer = createParticleBuffer(resolution, decay);
    let particles = null;
    let spawnCursor = 0;

    function seedParticles() {
        particles = [];
        for (let i = 0; i < count; i++) {
            particles.push({ x: hashToUnit(i, 10, seed) * size, y: hashToUnit(i, 20, seed) * size, vx: 0, vy: 0 });
        }
    }

    const shapeField = statefulField({},
        (state, dt, ctx) => {
            if (inputField?.kind === 'stateful') inputField.advance(dt, ctx);
            if (!particles) seedParticles();
            const steps = accumulator.tick(dt);
            const stepDt = 1 / Math.max(0.0001, stepsPerSecond);
            const t = ctx?.currentTick ?? 0;
            for (let s = 0; s < steps; s++) {
                buffer.decayStep();
                // Input participates directly: wherever it's lit, respawn
                // the next particle in the pool there, round-robin, so a
                // continuously-lit input keeps refeeding the same fixed
                // pool instead of growing it unboundedly.
                if (inputField) {
                    for (let gy = 0; gy < size; gy++) {
                        for (let gx = 0; gx < size; gx++) {
                            const lit = inputField.kind === 'stateful' ? inputField.sample(gx, gy) : inputField.sample(gx, gy, t);
                            if (!lit) continue;
                            const p = particles[spawnCursor % particles.length];
                            p.x = gx; p.y = gy; p.vx = 0; p.vy = 0;
                            spawnCursor++;
                        }
                    }
                }
                for (const p of particles) {
                    const dx = originX - p.x, dy = originY - p.y;
                    const dist = Math.hypot(dx, dy) || 0.0001;
                    const accel = strength / (dist * dist + 1); // softened inverse-square
                    p.vx = (p.vx + (dx / dist) * accel * stepDt) * damping;
                    p.vy = (p.vy + (dy / dist) * accel * stepDt) * damping;
                    p.x = Math.max(0, Math.min(size, p.x + p.vx));
                    p.y = Math.max(0, Math.min(size, p.y + p.vy));
                    buffer.deposit(p.x, p.y, 1);
                }
            }
        },
        (state, x, y) => buffer.read(x, y));

    const resolveColour = resolveColourOrGradient(params.colour, context);
    const cycleMode = resolveCycleMode(params.colour);
    return colourCycleField(shapeField, resolveColour, cycleMode, { resolution, ...resolveCycleOpts(params.colour) });
}