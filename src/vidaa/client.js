// -----------------------------------------------------------------------------
// MQTT client of a Hisense VIDAA TV.
//
// One connection to the broker the TV runs on port 36669 (TLS, self-signed
// certificate). The client:
//   - finds the credentials the TV accepts (saved token, then the dynamic
//     methods, then the fixed login) and remembers the one that worked;
//   - subscribes to the state, volume and pairing topics and re-emits them as
//     events ('state', 'volume', 'pairing', 'disconnected');
//   - exposes the commands (keys, volume, sources, apps) and the PIN pairing.
//
// It never reconnects on its own: the integration polls the TV and calls
// connect() again, which also detects that the TV came back on.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import mqtt from 'mqtt';
import { createLogger } from '@gladysassistant/integration-sdk';
import { AUTH_METHODS, authMethodOrder, generateCredentials } from './credentials.js';
import {
  BROADCAST_TOPICS,
  COMMANDS,
  DEFAULT_PORT,
  commandTopic,
  subscriptionTopics,
  tokenRequestTopic,
} from './protocol.js';

const logger = createLogger({ name: 'vidaa' });

const KEEPALIVE_SECONDS = 20;
const DAY_SECONDS = 86400;

// CONNACK return codes meaning "wrong credentials": try the next method.
// Anything else (refused, unreachable, timeout) means the TV is not there.
const AUTH_REFUSED_CODES = new Set([4, 5, 134, 135]);

export class VidaaAuthError extends Error {}
export class VidaaUnreachableError extends Error {}
export class VidaaTimeoutError extends Error {}

function parsePayload(buffer) {
  const text = buffer?.toString('utf8') ?? '';
  if (text === '') {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Turn a `tokenissuance` payload into what the store keeps.
 */
export function tokensFromIssuance(payload, now = nowSeconds()) {
  const accessTime = Number(payload.accesstoken_time) || now;
  const refreshTime = Number(payload.refreshtoken_time) || now;
  return {
    access: payload.accesstoken,
    accessExpiresAt: accessTime + Number(payload.accesstoken_duration_day ?? 7) * DAY_SECONDS,
    refresh: payload.refreshtoken,
    refreshExpiresAt: refreshTime + Number(payload.refreshtoken_duration_day ?? 30) * DAY_SECONDS,
  };
}

export class VidaaClient extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.host       IP address or hostname of the TV
   * @param {number} [options.port]     broker port (36669)
   * @param {string} [options.authMode] 'auto' or one of AUTH_METHODS
   * @param {string} [options.cert]     client certificate (PEM), mutual TLS
   * @param {string} [options.key]      private key of the certificate (PEM)
   * @param {object} options.store      pairing store (see store.js)
   * @param {Function} [options.connectFn] mqtt.connect, replaced in the tests
   */
  constructor({
    host,
    port = DEFAULT_PORT,
    authMode = 'auto',
    cert,
    key,
    store,
    connectFn = mqtt.connect,
    connectTimeoutMs = 5000,
    responseTimeoutMs = 5000,
  }) {
    super();
    this.host = host;
    this.port = port;
    this.authMode = authMode;
    this.cert = cert;
    this.key = key;
    this.store = store;
    this.connectFn = connectFn;
    this.connectTimeoutMs = connectTimeoutMs;
    this.responseTimeoutMs = responseTimeoutMs;

    this.mqttClient = null;
    this.credentials = null;
    this.method = null;
    this.connecting = null;
    this.waiters = new Set();
  }

  get connected() {
    return Boolean(this.mqttClient?.connected);
  }

  // --- Connection ----------------------------------------------------------

  /** Connect if needed. Resolves once subscribed; rejects when unreachable. */
  connect() {
    if (this.connected) {
      return Promise.resolve();
    }
    if (!this.connecting) {
      this.connecting = this.doConnect().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  async doConnect() {
    if (!this.host) {
      throw new VidaaUnreachableError('No TV address configured');
    }
    const candidates = await this.buildCandidates();
    let lastError;
    for (const candidate of candidates) {
      try {
        const client = await this.attempt(candidate);
        await this.onConnected(client, candidate);
        return;
      } catch (err) {
        lastError = err;
        if (!(err instanceof VidaaAuthError)) {
          // The TV is off or unreachable: other credentials will not help.
          throw err;
        }
        logger.debug(`Credentials "${candidate.label}" refused by the TV`);
      }
    }
    throw lastError ?? new VidaaAuthError('The TV refused every credential');
  }

  /**
   * Credentials to try, in order: the saved token (or the refresh token when
   * the access token expired), then the generated credentials.
   */
  async buildCandidates() {
    const saved = await this.store.load();
    const uuid = await this.store.getUuid();
    const now = nowSeconds();
    const candidates = [];

    const token = saved.token;
    if (token?.access && saved.clientId && saved.username) {
      if (token.accessExpiresAt > now) {
        candidates.push({
          label: 'access token',
          method: saved.method,
          clientId: saved.clientId,
          username: saved.username,
          password: token.access,
        });
      } else if (token.refresh && token.refreshExpiresAt > now) {
        candidates.push({
          label: 'refresh token',
          method: saved.method,
          clientId: saved.clientId,
          username: saved.username,
          password: token.refresh,
          refresh: true,
        });
      }
    }

    const methods =
      this.authMode === 'auto' ? authMethodOrder(saved.method ?? 'auto') : [this.authMode];
    for (const method of methods) {
      candidates.push({ label: method, method, ...generateCredentials({ uuid, method }) });
    }
    return candidates;
  }

  attempt(candidate) {
    return new Promise((resolve, reject) => {
      const client = this.connectFn(`mqtts://${this.host}:${this.port}`, {
        protocolVersion: 4,
        clientId: candidate.clientId,
        username: candidate.username,
        password: candidate.password,
        clean: true,
        keepalive: KEEPALIVE_SECONDS,
        reconnectPeriod: 0,
        connectTimeout: this.connectTimeoutMs,
        // The TV presents a self-signed certificate issued for "RemoteCA".
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
        ...(this.cert && this.key ? { cert: this.cert, key: this.key } : {}),
      });

      let settled = false;
      const finish = (err) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        client.removeListener('connect', onConnect);
        client.removeListener('error', onError);
        client.removeListener('close', onClose);
        if (err) {
          // A late error of the abandoned connection must not crash the process.
          client.on('error', () => {});
          client.end(true);
          reject(err);
        } else {
          resolve(client);
        }
      };
      const onConnect = () => finish();
      const onError = (err) => {
        if (AUTH_REFUSED_CODES.has(err?.code)) {
          finish(new VidaaAuthError(err.message));
        } else {
          finish(new VidaaUnreachableError(err?.message ?? 'Connection error'));
        }
      };
      const onClose = () => finish(new VidaaUnreachableError('Connection closed by the TV'));
      const timer = setTimeout(
        () => finish(new VidaaUnreachableError('The TV did not answer')),
        this.connectTimeoutMs,
      );

      client.on('connect', onConnect);
      client.on('error', onError);
      client.on('close', onClose);
    });
  }

  async onConnected(client, candidate) {
    this.mqttClient = client;
    this.credentials = candidate;
    this.method = candidate.method;
    logger.info(`Connected to the TV at ${this.host} (${candidate.label})`);

    client.on('message', (topic, payload) => this.handleMessage(topic, parsePayload(payload)));
    client.on('error', (err) => logger.debug(`MQTT error: ${err.message}`));
    client.on('close', () => {
      if (this.mqttClient === client) {
        this.mqttClient = null;
        logger.info('Connection to the TV closed');
        this.emit('disconnected');
      }
    });

    await new Promise((resolve) => {
      // Some firmware refuses some topics: a refused subscription is not fatal.
      client.subscribe(subscriptionTopics(candidate.clientId), { qos: 0 }, () => resolve());
    });

    if (!candidate.label.endsWith('token')) {
      await this.store.save({
        method: candidate.method,
        clientId: candidate.clientId,
        username: candidate.username,
      });
    }
    if (candidate.refresh) {
      // Connected with the refresh token: ask for a fresh access token.
      this.publish(tokenRequestTopic(candidate.clientId), {
        refreshtoken: candidate.password,
      });
    }
    this.emit('connected');
  }

  disconnect() {
    const client = this.mqttClient;
    this.mqttClient = null;
    this.rejectWaiters(new VidaaUnreachableError('Disconnected'));
    if (client) {
      client.end(true);
    }
  }

  // --- Messages ------------------------------------------------------------

  handleMessage(topic, payload) {
    for (const waiter of [...this.waiters]) {
      if (waiter.match(topic, payload)) {
        this.waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(payload);
      }
    }

    if (topic === BROADCAST_TOPICS.SLEEP) {
      this.emit('state', { statetype: 'fake_sleep_0' });
    } else if (topic.endsWith('/ui_service/state') || topic.endsWith('/ui_service/data/state')) {
      if (payload && typeof payload === 'object') {
        this.emit('state', payload);
      }
    } else if (topic.endsWith('/volume') || topic.endsWith('/volumechange')) {
      if (payload && typeof payload === 'object') {
        this.emit('volume', payload);
      }
    } else if (topic.endsWith('/data/tokenissuance')) {
      if (payload?.accesstoken) {
        this.saveTokens(payload).catch((err) => logger.error('Saving the TV tokens failed', err));
      }
    } else if (topic.endsWith('/data/authentication')) {
      this.emit('pairing');
    }
  }

  async saveTokens(payload) {
    // The token becomes the password of the credentials that obtained it.
    await this.store.save({
      method: this.credentials?.method,
      clientId: this.credentials?.clientId,
      username: this.credentials?.username,
      token: tokensFromIssuance(payload),
    });
    logger.info('The TV issued a new access token');
    this.emit('token');
  }

  waitFor(match, timeoutMs = this.responseTimeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve, reject };
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new VidaaTimeoutError('The TV did not answer in time'));
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  rejectWaiters(err) {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    this.waiters.clear();
  }

  publish(topic, payload = '') {
    if (!this.connected) {
      throw new VidaaUnreachableError('Not connected to the TV');
    }
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.mqttClient.publish(topic, body, { qos: 0 });
  }

  command([service, action], payload) {
    this.publish(commandTopic(service, this.credentials.clientId, action), payload);
  }

  /** Publish a command and resolve the first message whose topic ends with `suffix`. */
  async request(command, payload, suffix, timeoutMs) {
    const answer = this.waitFor((topic) => topic.endsWith(suffix), timeoutMs);
    try {
      this.command(command, payload);
    } catch (err) {
      answer.catch(() => {});
      throw err;
    }
    return answer;
  }

  // --- Commands ------------------------------------------------------------

  sendKey(key) {
    this.command(COMMANDS.SEND_KEY, key);
  }

  setVolume(level) {
    const value = Math.max(0, Math.min(100, Math.round(Number(level))));
    this.command(COMMANDS.SET_VOLUME, String(value));
  }

  getState() {
    return this.request(COMMANDS.GET_STATE, '', '/state');
  }

  /** The speaker volume `{ volume_type: 0, volume_value }`. */
  async getVolume() {
    // The answer comes on the broadcast topic or on the client's own one.
    const answer = this.waitFor(
      (topic, payload) =>
        (topic.endsWith('/volume') || topic.endsWith('/volumechange')) &&
        Number(payload?.volume_type ?? 0) === 0,
    );
    try {
      this.command(COMMANDS.GET_VOLUME, '');
    } catch (err) {
      answer.catch(() => {});
      throw err;
    }
    return answer;
  }

  async getSources() {
    const list = await this.request(COMMANDS.GET_SOURCES, '', '/data/sourcelist');
    return Array.isArray(list) ? list : [];
  }

  changeSource(source) {
    this.command(COMMANDS.SET_SOURCE, {
      sourceid: String(source.sourceid),
      sourcename: source.sourcename ?? source.displayname ?? '',
    });
  }

  async getApps() {
    const list = await this.request(COMMANDS.GET_APPS, '', '/data/applist');
    return Array.isArray(list) ? list : [];
  }

  launchApp(app) {
    this.command(COMMANDS.LAUNCH_APP, {
      appId: app.appId ?? '',
      name: app.name,
      url: app.url,
      urlType: app.urlType ?? 37,
      storeType: app.storeType ?? 0,
    });
  }

  // --- Pairing -------------------------------------------------------------

  /**
   * Ask the TV to display a PIN. Resolves 'pin' when the TV says the PIN is on
   * screen, 'already_paired' when it accepted the request without one.
   */
  async startPairing(timeoutMs = 10000) {
    const answer = this.waitFor(
      (topic) =>
        topic.endsWith('/data/authentication') || topic.endsWith('/data/vidaa_app_connect'),
      timeoutMs,
    );
    if (this.method === AUTH_METHODS.STATIC) {
      // Old firmware has no pairing request: any command from an unknown
      // client makes it show the PIN.
      this.command(COMMANDS.GET_STATE, '');
    } else {
      this.command(COMMANDS.PAIRING_START, {
        app_version: 2,
        connect_result: 0,
        device_type: 'Mobile App',
      });
    }
    const first = await answer.then(
      (payload) => ({ payload }),
      (err) => ({ err }),
    );
    if (first.err) {
      throw first.err;
    }
    // The "accepted" acknowledgement can precede the PIN push: wait a little
    // for the latter before concluding that no PIN is needed.
    if (first.payload && typeof first.payload === 'object' && 'connect_result' in first.payload) {
      try {
        await this.waitFor((topic) => topic.endsWith('/data/authentication'), 3000);
        return 'pin';
      } catch {
        return 'already_paired';
      }
    }
    return 'pin';
  }

  /**
   * Send the PIN displayed on the TV. Resolves once the TV accepted it (and
   * issued its tokens, on firmware that does); rejects otherwise.
   */
  async sendPin(pin, timeoutMs = 10000) {
    const code = String(pin ?? '').trim();
    if (!/^\d{4,8}$/.test(code)) {
      throw new VidaaAuthError('The PIN must be the digits displayed on the TV');
    }
    const accepted = await this.request(
      COMMANDS.PAIRING_CODE,
      // The TV expects a number, not a string.
      { authNum: Number(code) },
      '/data/authenticationcode',
      timeoutMs,
    );
    if (Number(accepted?.result) !== 1) {
      throw new VidaaAuthError('The TV refused the PIN');
    }
    await this.store.save({ paired: true });
    if (this.method === AUTH_METHODS.STATIC) {
      // Old firmware authorizes the client id itself and issues no token.
      return;
    }
    const token = this.waitFor((topic) => topic.endsWith('/data/tokenissuance'), timeoutMs);
    this.publish(tokenRequestTopic(this.credentials.clientId), { refreshtoken: '' });
    this.command(COMMANDS.PAIRING_CLOSE, '');
    try {
      await token;
    } catch {
      // Some firmware accepts the PIN without issuing a token: the generated
      // credentials keep working, nothing else to do.
      logger.info('PIN accepted, the TV issued no token');
    }
  }
}
