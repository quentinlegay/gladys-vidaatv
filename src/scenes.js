// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// Each handler receives the RESOLVED fields of the action (scene variables
// substituted, defaults applied, validated by the core) and returns the
// declared outputs. Throwing fails this action only: the scene continues.
// -----------------------------------------------------------------------------

import { ALL_KEY_NAMES } from './vidaa/protocol.js';

export const SCENE_ACTIONS = {
  // Press one key of the remote, as many times as asked (volume steps...).
  async send_key(tv, { fields }) {
    const key = String(fields.key ?? '');
    if (!ALL_KEY_NAMES.includes(key)) {
      throw new Error(`Unknown remote key "${key}"`);
    }
    const times = Math.max(1, Math.min(20, Math.round(Number(fields.repeat ?? 1)) || 1));
    for (let i = 0; i < times; i += 1) {
      await tv.sendKey(key);
    }
    return { sent: true };
  },

  // Open an application of the TV, by its name ("Netflix", "YouTube"...).
  async launch_app(tv, { fields }) {
    const app = await tv.launchApp(fields.app);
    return { app: app.name };
  },
};
