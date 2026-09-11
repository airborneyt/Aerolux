// src/lib/aerolux/audio/ost/catalog.js

import { defineTracks, definePack } from './packs.js';

defineTracks([
    { id: 'track_00', source: '/sounds/ost/track_00.mp3' },
    { id: 'track_01', source: '/sounds/ost/track_01.mp3' },
    { id: 'track_02', source: '/sounds/ost/track_02.mp3' },
    { id: 'track_03', source: '/sounds/ost/track_03.mp3' },
    { id: 'track_04', source: '/sounds/ost/track_04.mp3' },
    { id: 'track_05', source: '/sounds/ost/track_05.mp3' },
    { id: 'track_06', source: '/sounds/ost/track_06.mp3' },
    { id: 'default_7am',      source: '/sounds/ost/default/7am.mp3' },
    { id: 'track_08', source: '/sounds/ost/track_08.mp3' },
    { id: 'track_09', source: '/sounds/ost/track_09.mp3' },
    { id: 'track_10', source: '/sounds/ost/track_10.mp3' },
    { id: 'track_11', source: '/sounds/ost/track_11.mp3' },
    { id: 'track_12', source: '/sounds/ost/track_12.mp3' },
    { id: 'track_13', source: '/sounds/ost/track_13.mp3' },
    { id: 'track_14', source: '/sounds/ost/track_14.mp3' },
    { id: 'track_15', source: '/sounds/ost/track_15.mp3' },
    { id: 'track_16', source: '/sounds/ost/track_16.mp3' },
    { id: 'track_17', source: '/sounds/ost/track_17.mp3' },
    { id: 'track_18', source: '/sounds/ost/track_18.mp3' },
    { id: 'default_7pm',      source: '/sounds/ost/default/7pm.mp3' },
    { id: 'track_20', source: '/sounds/ost/track_20.mp3' },
    { id: 'track_21', source: '/sounds/ost/track_21.mp3' },
    { id: 'track_22', source: '/sounds/ost/track_22.mp3' },
    { id: 'track_23', source: '/sounds/ost/track_23.mp3' },
]);

definePack({
    id: 'default',
    name: 'Aerolux Default',
    schedule: [
        // index = local hour, 0-23
        'track_00', 'track_01', 'track_02', 'track_03',
        'track_04', 'track_05', 'track_06', 'default_7am',
        'track_08', 'track_09', 'track_10', 'track_11',
        'track_12', 'track_13', 'track_14', 'track_15',
        'track_16', 'track_17', 'track_18', 'default_7pm',
        'track_20', 'track_21', 'track_22', 'track_23',
    ],
});