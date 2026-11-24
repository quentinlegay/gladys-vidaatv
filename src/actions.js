// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen.
//
// Each handler resolves the multi-language message displayed under the button.
// Errors are turned into a message too: an action that throws only shows a
// generic failure, the user needs to know what to fix.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { describeError } from './tv.js';

const logger = createLogger({ name: 'actions' });

function withUserMessage(name, run) {
  return async (tv, context) => {
    try {
      return await run(tv, context);
    } catch (err) {
      logger.warn(`Action ${name} failed: ${err.message}`);
      return describeError(err);
    }
  };
}

export const ACTIONS = {
  pair_start: withUserMessage('pair_start', (tv) => tv.startPairing()),
  pair_confirm: withUserMessage('pair_confirm', (tv, { fields }) => tv.confirmPairing(fields.pin)),
  test_connection: withUserMessage('test_connection', (tv) => tv.testConnection()),
  reset_pairing: withUserMessage('reset_pairing', (tv) => tv.resetPairing()),
};
