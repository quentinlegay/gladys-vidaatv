// -----------------------------------------------------------------------------
// Entry point of the Gladys "Hisense VIDAA TV" external integration.
//
// This file only wires the SDK to the TV controller (src/tv.js):
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects and publishes the TV device.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { ACTIONS } from './src/actions.js';
import { SCENE_ACTIONS } from './src/scenes.js';
import { createTvController } from './src/tv.js';
import { createStore } from './src/vidaa/store.js';

const gladys = new GladysIntegration();
const tv = createTvController({ gladys, store: createStore() });

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  await tv.publishDevice();
});

// --- Command: the user acts on a feature of the TV ---------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  if (!tv.isOwnDevice(device)) {
    // Throw: the SDK sends a success:false acknowledgement to Gladys.
    throw new Error(`Unknown device ${device.external_id}`);
  }
  await tv.setValue(feature, value);
});

// --- Polling: notice the TV switched on or off from its own remote -----------
gladys.onPoll(async (device) => {
  if (tv.isOwnDevice(device)) {
    await tv.refresh();
  }
});

// --- Manifest actions: buttons of the Configuration screen -------------------
for (const [key, handler] of Object.entries(ACTIONS)) {
  gladys.onAction(key, (fields) => handler(tv, { fields }));
}

// --- Scene actions -----------------------------------------------------------
for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(key, (fields) => handler(tv, { fields }));
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  await tv.configure(normalizeConfig(newConfig));
  await tv.publishDevice();
  await tv.refresh();
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    await tv.configure(normalizeConfig(await gladys.getConfig()));
    await tv.publishDevice();
    await tv.refresh();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  tv.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Hisense VIDAA TV integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
