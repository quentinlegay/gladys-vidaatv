// -----------------------------------------------------------------------------
// TV controller: the bridge between Gladys and the VIDAA client.
//
// It owns the client (re-created when the address or the certificate change),
// tracks the TV state (power, volume, source) and publishes it to Gladys, and
// turns Gladys commands, actions and scene actions into VIDAA commands.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { configProblem } from './config.js';
import {
  BUTTON_FEATURES,
  DEFAULT_APPS,
  DEFAULT_SOURCES,
  FEATURE,
  appValue,
  buildTelevisionDevice,
  deviceIds,
  featureKeyOf,
  sourceValue,
} from './devices/television.js';
import { VidaaAuthError, VidaaClient, VidaaTimeoutError } from './vidaa/client.js';
import { KEYS, isSleepState } from './vidaa/protocol.js';

const logger = createLogger({ name: 'tv' });

// After a Wake-on-LAN packet, how long the TV may take to bring its network up.
const WAKE_ATTEMPTS = 10;
const WAKE_INTERVAL_MS = 2500;

// Unref'd: a pending wake-up confirmation never keeps the process alive.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref());

/** A user-facing error: its `message` is a multi-language object. */
export class UserError extends Error {
  constructor(message) {
    super(message.en);
    this.userMessage = message;
  }
}

const MESSAGES = {
  unreachable: {
    en: 'The TV does not answer. Check that it is on (or in standby with network) and that its IP address is right.',
    fr: "Le téléviseur ne répond pas. Vérifiez qu'il est allumé (ou en veille réseau) et que son adresse IP est correcte.",
  },
  certificate: {
    en: 'The TV refused the secure connection: this model needs the client certificate and its key (see the documentation).',
    fr: 'Le téléviseur a refusé la connexion sécurisée : ce modèle exige le certificat client et sa clé (voir la documentation).',
  },
  refused: {
    en: 'The TV refused every login method. Try another authentication method, or add the client certificate.',
    fr: "Le téléviseur a refusé toutes les méthodes de connexion. Essayez une autre méthode d'authentification, ou ajoutez le certificat client.",
  },
};

function looksLikeTlsRefusal(err) {
  return /certificate|handshake|alert|ssl|tls/i.test(err?.message ?? '');
}

/** Translate a client error into a message for the user. */
export function describeError(err) {
  if (err instanceof UserError) {
    return err.userMessage;
  }
  if (err instanceof VidaaAuthError) {
    return MESSAGES.refused;
  }
  if (looksLikeTlsRefusal(err)) {
    return MESSAGES.certificate;
  }
  return MESSAGES.unreachable;
}

export function createTvController({
  gladys,
  store,
  createClient = (options) => new VidaaClient(options),
}) {
  let config = null;
  let client = null;
  let clientKey = '';
  let lists = { sources: [], apps: [] };
  let listsLoaded = false;
  // Bumped by stop() and by each wake-up: an older confirmation loop gives up.
  let generation = 0;
  const state = { power: null, volume: null, source: null };

  // --- Client lifecycle ----------------------------------------------------

  function attachClient() {
    const key = JSON.stringify([
      config.tv_host,
      config.auth_mode,
      config.client_cert,
      config.client_key,
    ]);
    if (client && key === clientKey) {
      return;
    }
    client?.removeAllListeners();
    client?.disconnect();
    clientKey = key;
    client = createClient({
      host: config.tv_host,
      authMode: config.auth_mode,
      cert: config.client_cert,
      key: config.client_key,
      store,
    });
    client.on('state', (tvState) => {
      onTvState(tvState).catch((err) => logger.error('Publishing the TV state failed', err));
    });
    client.on('volume', (volume) => {
      onVolume(volume).catch((err) => logger.error('Publishing the volume failed', err));
    });
    client.on('disconnected', () => {
      // The broker goes away with the TV: it was switched off (or unplugged).
      publish({ power: 0 }).catch(() => {});
    });
  }

  async function ensureConnected() {
    const problem = configProblem(config);
    if (problem) {
      throw new UserError(problem);
    }
    attachClient();
    const wasConnected = client.connected;
    await client.connect();
    if (!wasConnected) {
      await onConnected();
    }
    return client;
  }

  async function onConnected() {
    await gladys.setConnectionStatus(true).catch(() => {});
    await refreshLists();
  }

  /** Fetch the sources and apps of the TV, republish the device when they changed. */
  async function refreshLists() {
    const [sources, apps] = await Promise.all([
      client.getSources().catch(() => null),
      client.getApps().catch(() => null),
    ]);
    const next = {
      sources: sources?.length ? sources : lists.sources,
      apps: apps?.length ? apps : lists.apps,
    };
    if (JSON.stringify(next) !== JSON.stringify(lists)) {
      lists = next;
      await store.save({ lists });
      await publishDevice();
    }
  }

  // --- States --------------------------------------------------------------

  async function publish(changes) {
    Object.assign(state, changes);
    if (!config || configProblem(config)) {
      return;
    }
    const ids = deviceIds(gladys, config);
    const states = [];
    if (changes.power !== undefined && changes.power !== null) {
      states.push({ device_feature_external_id: ids.feature(FEATURE.POWER), state: changes.power });
    }
    if (Number.isFinite(changes.volume)) {
      states.push({
        device_feature_external_id: ids.feature(FEATURE.VOLUME),
        state: changes.volume,
      });
    }
    if (typeof changes.source === 'string') {
      states.push({
        device_feature_external_id: ids.feature(FEATURE.SOURCE),
        text: changes.source,
      });
    }
    if (states.length > 0) {
      try {
        await gladys.publishChangedStates(states);
      } catch (err) {
        // Typically: the user has not added the TV in Gladys yet.
        logger.debug(`States not published: ${err.message}`);
      }
    }
  }

  async function onTvState(tvState) {
    if (isSleepState(tvState)) {
      await publish({ power: 0 });
      return;
    }
    const changes = { power: 1 };
    if (tvState.statetype === 'sourceswitch' && tvState.sourceid !== undefined) {
      changes.source = String(tvState.sourceid);
    }
    await publish(changes);
  }

  async function onVolume(volume) {
    // volume_type 0 is the speaker level; 2 is the mute flag.
    if (Number(volume.volume_type ?? 0) !== 0) {
      return;
    }
    const level = Number(volume.volume_value ?? volume.volume ?? volume.value);
    if (Number.isFinite(level)) {
      await publish({ volume: level });
    }
  }

  // --- Public API ----------------------------------------------------------

  async function configure(newConfig) {
    config = newConfig;
    if (!listsLoaded) {
      const saved = await store.load();
      lists = saved.lists ?? lists;
      listsLoaded = true;
    }
    const problem = configProblem(config);
    if (problem) {
      client?.removeAllListeners();
      client?.disconnect();
      client = null;
      clientKey = '';
      await gladys.setConnectionStatus(false, problem).catch(() => {});
      return;
    }
    attachClient();
    await gladys.setConnectionStatus(true).catch(() => {});
  }

  function buildDevices() {
    if (!config || configProblem(config)) {
      return [];
    }
    return [buildTelevisionDevice(gladys, config, lists)];
  }

  async function publishDevice() {
    const devices = buildDevices();
    if (devices.length > 0) {
      await gladys.publishDiscoveredDevices(devices);
    }
  }

  /** Periodic check: is the TV on, at which volume. */
  async function refresh() {
    if (!config || configProblem(config)) {
      return;
    }
    try {
      await ensureConnected();
    } catch (err) {
      if (err instanceof VidaaAuthError || looksLikeTlsRefusal(err)) {
        await gladys.setConnectionStatus(false, describeError(err)).catch(() => {});
      }
      logger.debug(`TV unreachable: ${err.message}`);
      await publish({ power: 0 });
      return;
    }
    const tvState = await client.getState().catch(() => null);
    await onTvState(tvState ?? { statetype: 'unknown' });
    if (state.power === 1) {
      const volume = await client.getVolume().catch(() => null);
      if (volume) {
        await onVolume(volume);
      }
    }
  }

  async function wake() {
    if (client?.connected && state.power === 0) {
      // Standby with network ("fake sleep"): the power key wakes it up.
      client.sendKey(KEYS.POWER);
      return;
    }
    await gladys.wakeOnLan(
      config.tv_mac,
      config.wol_broadcast ? { address: config.wol_broadcast } : undefined,
    );
    // Confirm in the background: the TV takes a few seconds to boot.
    generation += 1;
    const current = generation;
    (async () => {
      for (let attempt = 0; attempt < WAKE_ATTEMPTS; attempt += 1) {
        await sleep(WAKE_INTERVAL_MS);
        if (current !== generation) {
          return;
        }
        try {
          await ensureConnected();
          await refresh();
          return;
        } catch {
          // Not up yet.
        }
      }
      logger.info('The TV did not come up after Wake-on-LAN');
    })().catch(() => {});
  }

  async function setPower(on) {
    if (on) {
      attachClient();
      await wake();
      return;
    }
    const tv = await ensureConnected();
    if (state.power !== 0) {
      tv.sendKey(KEYS.POWER);
    }
    await publish({ power: 0 });
  }

  function findSource(value) {
    const all = lists.sources.length ? lists.sources : DEFAULT_SOURCES;
    const wanted = String(value).toLowerCase();
    return all.find(
      (source) =>
        sourceValue(source) === String(value) ||
        String(source.sourcename ?? '').toLowerCase() === wanted ||
        String(source.displayname ?? '').toLowerCase() === wanted,
    );
  }

  function findApp(value) {
    const all = lists.apps.length ? lists.apps : DEFAULT_APPS;
    const wanted = String(value).trim().toLowerCase();
    return all.find(
      (app) =>
        appValue(app).toLowerCase() === wanted || String(app.url ?? '').toLowerCase() === wanted,
    );
  }

  async function launchApp(value) {
    const app = findApp(value);
    if (!app) {
      throw new UserError({
        en: `Unknown application "${value}".`,
        fr: `Application « ${value} » inconnue.`,
      });
    }
    const tv = await ensureConnected();
    tv.launchApp(app);
    return app;
  }

  async function sendKey(key) {
    const tv = await ensureConnected();
    tv.sendKey(key);
  }

  async function setValue(feature, value) {
    const key = featureKeyOf(gladys, config, feature.external_id);
    if (key === FEATURE.POWER) {
      await setPower(Number(value) === 1);
      return;
    }
    if (key === FEATURE.VOLUME) {
      const tv = await ensureConnected();
      tv.setVolume(value);
      await publish({ volume: Math.max(0, Math.min(100, Math.round(Number(value)))) });
      return;
    }
    if (key === FEATURE.SOURCE) {
      const source = findSource(value);
      if (!source) {
        throw new UserError({
          en: `Unknown source "${value}".`,
          fr: `Source « ${value} » inconnue.`,
        });
      }
      const tv = await ensureConnected();
      tv.changeSource(source);
      await publish({ source: sourceValue(source) });
      return;
    }
    if (key === FEATURE.APP) {
      await launchApp(value);
      return;
    }
    const button = BUTTON_FEATURES.find((candidate) => candidate.key === key);
    if (button) {
      await sendKey(button.tvKey);
      return;
    }
    throw new Error(`Unknown feature ${feature.external_id}`);
  }

  // --- Pairing (manifest actions) -------------------------------------------

  async function startPairing() {
    const tv = await ensureConnected();
    const result = await tv.startPairing();
    if (result === 'already_paired') {
      return {
        en: 'The TV already knows Gladys: no PIN needed, you can use it.',
        fr: 'Le téléviseur connaît déjà Gladys : pas de code nécessaire, vous pouvez l’utiliser.',
      };
    }
    return {
      en: 'A PIN is displayed on the TV: enter it in the "Confirm pairing" action within a minute.',
      fr: 'Un code est affiché sur le téléviseur : saisissez-le dans l’action « Confirmer l’appairage » dans la minute.',
    };
  }

  async function confirmPairing(pin) {
    const tv = await ensureConnected();
    try {
      await tv.sendPin(pin);
    } catch (err) {
      if (err instanceof VidaaTimeoutError) {
        throw new UserError({
          en: 'The TV did not answer: start the pairing again to get a new PIN.',
          fr: "Le téléviseur n'a pas répondu : relancez l'appairage pour obtenir un nouveau code.",
        });
      }
      if (err instanceof VidaaAuthError) {
        throw new UserError({
          en: 'The TV refused this PIN: start the pairing again.',
          fr: "Le téléviseur a refusé ce code : relancez l'appairage.",
        });
      }
      throw err;
    }
    await refreshLists();
    await refresh();
    return {
      en: 'Paired! Gladys can now control the TV.',
      fr: 'Appairé ! Gladys peut maintenant piloter le téléviseur.',
    };
  }

  async function testConnection() {
    const tv = await ensureConnected();
    const volume = await tv.getVolume().catch(() => null);
    await refresh();
    if (!volume) {
      return {
        en: `Connected to the TV (${tv.method} login), but it ignores the commands: pair it first.`,
        fr: `Connecté au téléviseur (connexion ${tv.method}), mais il ignore les commandes : appairez-le d'abord.`,
      };
    }
    return {
      en: `Connected to the TV (${tv.method} login), commands accepted. Volume: ${volume.volume_value}.`,
      fr: `Connecté au téléviseur (connexion ${tv.method}), commandes acceptées. Volume : ${volume.volume_value}.`,
    };
  }

  async function resetPairing() {
    client?.removeAllListeners();
    client?.disconnect();
    client = null;
    clientKey = '';
    await store.resetPairing();
    return {
      en: 'Pairing forgotten. Start the pairing again to get a new PIN.',
      fr: "Appairage oublié. Relancez l'appairage pour obtenir un nouveau code.",
    };
  }

  function stop() {
    generation += 1;
    client?.removeAllListeners();
    client?.disconnect();
    client = null;
    clientKey = '';
  }

  return {
    configure,
    buildDevices,
    publishDevice,
    refresh,
    setValue,
    sendKey,
    launchApp,
    startPairing,
    confirmPairing,
    testConnection,
    resetPairing,
    stop,
    isOwnDevice: (device) =>
      Boolean(config && !configProblem(config)) &&
      device.external_id === deviceIds(gladys, config).device,
    get state() {
      return { ...state };
    },
  };
}
