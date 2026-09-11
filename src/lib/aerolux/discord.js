// src/lib/aerolux/discord.js
// centralised discord rich presence server
//
// this file:
// - starts and stops the drpc connection
// - follows settings.activity
// - publishes and updates the current activity
// - manages aerolux activity contexts
// - cleans up aerolux
// 
// this is the only place in aerolux that imports
// tauri-plugin-drpc directly

import {
  start,
  stop,
  clearActivity,
  setActivity
} from 'tauri-plugin-drpc';

import { settings, saveSetting } from '../../stores/settings.svelte.js';

//config
const CLIENT_ID = '1509091230972121098';

// internal state

let running = false;
let currentContext = 'home';
let currentActivity = null;

// activity context & builder –––––––––––––––––––––––––––––––––––––––

// these are the default activities for different pages in aerolux
// individual contexts can be overriden with additional data using
// setDiscordContext()
// e.g. setDiscordContext('velocity', {
//        details: 'Editing 16-step gradient'
//      });

export const DISCORD_CONTEXTS = {
  home: {
    details: 'Exploring Aerolux',
    state: 'Light Effect Studio'
  },

  velocity: {
    details: 'Painting with colours',
    state: 'Velocity'
  },

  kinetic: {
    details: 'Crafting light effects',
    state: 'Kinetic'
  },

  settings: {
    details: 'Configuring Aerolux',
    state: 'Settings'
  },
};

function buildActivity(overrides = {}) {
  return {
    details: 'Exploring Aerolux',
    state: 'Light Effect Studio',

    assets: {
      large_image: 'aerolux',
      large_text: 'Aerolux'
    },

    ...overrides
  };
}

// internal publish function
async function publishActivity() {
  if (!running) {
    return;
  }
  const context = DISCORD_CONTEXTS[currentContext] ?? {};
  const activity = buildActivity({
    ...context,
    ...(currentActivity ?? {})
  });
  try {
    await setActivity(activity);
  } catch (error) {
    console.error('[Discord] Failed to publish activity:', error);
  }
}

// init –––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––

export async function initialiseDiscordActivity(enabled) {
  if (!enabled) {
    return;
  }

  await enableDiscordActivity();
}

// enable
export async function enableDiscordActivity() {
  if (running) {
    await publishActivity();
    return;
  }

  try {
    await start(CLIENT_ID);
    running = true;
    await publishActivity();
  } catch (error) {
    running = false;
    console.error(
      '[Discord] Failed to start Rich Presence:',
      error
    );
  }
}

// disable
export async function disableDiscordActivity() {
  if (!running) {
    return;
  }
  try {
    await clearActivity();
  } catch (error) {
    console.error(
      '[Discord] Failed to clear activity:',
      error
    );
  }
  try {
    await stop();
  } catch (error) {
    console.error(
      '[Discord] Failed to stop DRPC:',
      error
    );
  }
  running = false;
  currentActivity = null;
}

// settings toggle ––––––––––––––––––––––––––––––––––––––––––––––––––
// 1. update the reactive settings object
// 2. persist the setting
// 3. start/stop drpc accordingly

export async function setDiscordActivityEnabled(enabled) {
  settings.activity.enabled = enabled;
  try {
    await saveSetting(
      'activity.enabled',
      enabled
    );
  } catch (error) {
    console.error(
      '[Discord] Failed to save activity setting:',
      error
    );
  }
  if (enabled) {
    await enableDiscordActivity();
  } else {
    await disableDiscordActivity();
  }
}

// context management –––––––––––––––––––––––––––––––––––––––––––––––
// changes what aerolux is currently doing
//
// examples:
//
//   setDiscordContext('velocity');
//
//   setDiscordContext('kinetic', {
//     details: 'Editing {$project.name}',
//     state: '24 nodes'
//   });

export async function setDiscordContext(
  context,
  overrides = {}
) {
  if (!(context in DISCORD_CONTEXTS)) {
    console.warn(
      `[Discord] Unknown context: ${context}`
    );
    return;
  }
  currentContext = context;
  currentActivity = {
    ...overrides
  };
  await publishActivity();
}

// activity update ––––––––––––––––––––––––––––––––––––––––––––––––––
// use this when the context itself hasn't changed but some
// activity information has
//
// example:
//   updateDiscordActivity({
//     details: 'Editing My Gradient',
//     state: '16 steps'
//   });

export async function updateDiscordActivity(overrides = {}) {
  currentActivity = {
    ...currentActivity,
    ...overrides
  };

  await publishActivity();
}

// reset activity overrides
export async function resetDiscordActivity() {
  currentActivity = null;

  await publishActivity();
}

// status (debug function)
// use if another part in aerolux needs to know if drpc is active
export function isDiscordActivityRunning() {
  return running;
}

// shutdown –––––––––––––––––––––––––––––––––––––––––––––––––––––––––

export async function shutdownDiscordActivity() {
  if (!running) {
    return;
  }
  try {
    await clearActivity();
  } catch (error) {
    console.error(
      '[Discord] Failed to clear activity during shutdown:',
      error
    );
  }
  try {
    await stop();
  } catch (error) {
    console.error(
      '[Discord] Failed to stop DRPC during shutdown:',
      error
    );
  }
  running = false;
  currentActivity = null;
}