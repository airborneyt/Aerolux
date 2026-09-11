// src/lib/aerolux/audio/sfx/catalog.js

import { defineSounds } from './definitions.js';

defineSounds([
    {
        id: 'aerolux',
        source: '/sounds/aerolux.wav',
        priority: 100,
    },
    {
        id: 'trollsound',
        source: '/sounds/sfx/wrong-answer-buzzer.mp3',
        baseVolume: 0.3,
        priority: 30,
    },
]);