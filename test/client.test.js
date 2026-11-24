import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCredentials } from '../src/vidaa/credentials.js';
import {
  VidaaClient,
  VidaaUnreachableError,
  VidaaAuthError,
  tokensFromIssuance,
} from '../src/vidaa/client.js';
import { createFakeTv, tempStore, tick } from './helpers.js';

async function setup({ accept, onPublish, authMode = 'auto', store } = {}) {
  const tv = createFakeTv({ accept, onPublish });
  const client = new VidaaClient({
    host: '192.168.1.50',
    authMode,
    store: store ?? (await tempStore()),
    connectFn: tv.connectFn,
    connectTimeoutMs: 200,
    responseTimeoutMs: 100,
  });
  return { tv, client };
}

test('connects over TLS without checking the self-signed certificate', async () => {
  const { tv, client } = await setup();
  await client.connect();
  assert.ok(client.connected);
  assert.equal(client.method, 'modern');
  const [options] = tv.attempts;
  assert.equal(tv.current.url, 'mqtts://192.168.1.50:36669');
  assert.equal(options.rejectUnauthorized, false);
  assert.equal(options.protocolVersion, 4);
  assert.equal(options.reconnectPeriod, 0);
  assert.ok(tv.subscriptions.includes('/remoteapp/mobile/broadcast/ui_service/state'));
  client.disconnect();
});

test('falls back to the next method when the TV refuses the credentials, and remembers it', async () => {
  const store = await tempStore();
  const { tv, client } = await setup({
    store,
    accept: (options) => (options.username === 'hisenseservice' ? true : 5),
  });
  await client.connect();
  assert.equal(client.method, 'static');
  assert.equal(tv.attempts.length, 4);
  assert.equal((await store.load()).method, 'static');
  client.disconnect();

  // The next connection starts with the method that worked.
  const second = await setup({ store, accept: (options) => options.username === 'hisenseservice' });
  await second.client.connect();
  assert.equal(second.tv.attempts.length, 1);
  second.client.disconnect();
});

test('an unreachable TV stops the attempts at once', async () => {
  const { tv, client } = await setup({ accept: () => 'unreachable' });
  await assert.rejects(client.connect(), VidaaUnreachableError);
  assert.equal(tv.attempts.length, 1);
});

test('a forced method is the only one tried', async () => {
  const { tv, client } = await setup({ authMode: 'legacy', accept: () => 5 });
  await assert.rejects(client.connect(), VidaaAuthError);
  assert.equal(tv.attempts.length, 1);
  assert.match(tv.attempts[0].username, /^his\$\d{10}$/);
});

test('commands are published on the client topics', async () => {
  const { tv, client } = await setup();
  await client.connect();
  const id = client.credentials.clientId;
  client.sendKey('KEY_POWER');
  client.setVolume(142);
  client.changeSource({ sourceid: 3, sourcename: 'HDMI1' });
  client.launchApp({ name: 'Netflix', url: 'netflix' });
  assert.deepEqual(
    tv.published.map(({ topic }) => topic),
    [
      `/remoteapp/tv/remote_service/${id}/actions/sendkey`,
      `/remoteapp/tv/platform_service/${id}/actions/changevolume`,
      `/remoteapp/tv/ui_service/${id}/actions/changesource`,
      `/remoteapp/tv/ui_service/${id}/actions/launchapp`,
    ],
  );
  assert.equal(tv.published[0].payload, 'KEY_POWER');
  assert.equal(tv.published[1].payload, '100');
  assert.deepEqual(JSON.parse(tv.published[2].payload), { sourceid: '3', sourcename: 'HDMI1' });
  assert.equal(JSON.parse(tv.published[3].payload).url, 'netflix');
  client.disconnect();
});

test('requests resolve with the answer of the TV, and time out without one', async () => {
  const sources = [{ sourceid: '3', sourcename: 'HDMI1', displayname: 'HDMI 1' }];
  const { client } = await setup({
    onPublish: (topic, payload, tv) => {
      const id = topic.split('/')[4];
      if (topic.endsWith('/actions/sourcelist')) {
        setImmediate(() => tv.send(`/remoteapp/mobile/${id}/ui_service/data/sourcelist`, sources));
      }
      if (topic.endsWith('/actions/getvolume')) {
        setImmediate(() => {
          tv.send('/remoteapp/mobile/broadcast/ui_service/volume', {
            volume_type: 2,
            volume_value: 0,
          });
          tv.send('/remoteapp/mobile/broadcast/ui_service/volume', {
            volume_type: 0,
            volume_value: 23,
          });
        });
      }
    },
  });
  await client.connect();
  assert.deepEqual(await client.getSources(), sources);
  assert.deepEqual(await client.getVolume(), { volume_type: 0, volume_value: 23 });
  await assert.rejects(client.getApps(), /did not answer/);
  client.disconnect();
});

test('state, volume and standby broadcasts become events', async () => {
  const { tv, client } = await setup();
  await client.connect();
  const events = [];
  client.on('state', (state) => events.push(['state', state.statetype]));
  client.on('volume', (volume) => events.push(['volume', volume.volume_value]));
  client.on('disconnected', () => events.push(['disconnected']));
  tv.send('/remoteapp/mobile/broadcast/ui_service/state', { statetype: 'livetv' });
  tv.send('/remoteapp/mobile/broadcast/platform_service/actions/volumechange', {
    volume_type: 0,
    volume_value: 12,
  });
  tv.send('/remoteapp/mobile/broadcast/platform_service/actions/tvsleep', '');
  tv.drop();
  assert.deepEqual(events, [
    ['state', 'livetv'],
    ['volume', 12],
    ['state', 'fake_sleep_0'],
    ['disconnected'],
  ]);
  assert.equal(client.connected, false);
});

test('pairing: PIN displayed, PIN accepted, tokens saved and used next time', async () => {
  const store = await tempStore();
  const issuance = {
    accesstoken: 'access-1',
    accesstoken_time: Math.floor(Date.now() / 1000),
    accesstoken_duration_day: 7,
    refreshtoken: 'refresh-1',
    refreshtoken_time: Math.floor(Date.now() / 1000),
    refreshtoken_duration_day: 30,
  };
  const { tv, client } = await setup({
    store,
    onPublish: (topic, payload, fake) => {
      const id = topic.split('/')[4];
      const reply = (type, body) =>
        setImmediate(() => fake.send(`/remoteapp/mobile/${id}/ui_service/data/${type}`, body));
      if (topic.endsWith('/actions/vidaa_app_connect')) {
        reply('authentication', '');
      }
      if (topic.endsWith('/actions/authenticationcode')) {
        assert.deepEqual(JSON.parse(payload), { authNum: 1234 });
        reply('authenticationcode', { result: 1 });
      }
      if (topic.endsWith('/data/gettoken')) {
        reply('tokenissuance', issuance);
      }
    },
  });
  await client.connect();
  assert.equal(await client.startPairing(1000), 'pin');
  await client.sendPin('1234', 1000);
  await tick();
  const saved = await store.load();
  assert.equal(saved.paired, true);
  assert.equal(saved.token.access, 'access-1');
  assert.ok(tv.published.some(({ topic }) => topic.endsWith('/actions/authenticationcodeclose')));
  client.disconnect();

  // The next connection logs in with the token, as the official app does.
  const next = await setup({ store });
  await next.client.connect();
  assert.equal(next.tv.attempts[0].password, 'access-1');
  assert.equal(next.tv.attempts[0].clientId, saved.clientId);
  next.client.disconnect();
});

test('pairing: an already authorized client needs no PIN, a wrong PIN is refused', async () => {
  const { client } = await setup({
    onPublish: (topic, payload, fake) => {
      const id = topic.split('/')[4];
      if (topic.endsWith('/actions/vidaa_app_connect')) {
        setImmediate(() =>
          fake.send(`/remoteapp/mobile/${id}/ui_service/data/vidaa_app_connect`, {
            connect_result: 1,
          }),
        );
      }
      if (topic.endsWith('/actions/authenticationcode')) {
        setImmediate(() =>
          fake.send(`/remoteapp/mobile/${id}/ui_service/data/authenticationcode`, { result: 0 }),
        );
      }
    },
  });
  await client.connect();
  assert.equal(await client.startPairing(1000), 'already_paired');
  await assert.rejects(client.sendPin('0000', 500), /refused the PIN/);
  await assert.rejects(client.sendPin('abc'), /digits/);
  client.disconnect();
});

test('an expired access token falls back to the refresh token, then asks for a new one', async () => {
  const store = await tempStore();
  const uuid = await store.getUuid();
  const creds = generateCredentials({ uuid });
  const past = Math.floor(Date.now() / 1000) - 10;
  await store.save({
    method: 'modern',
    clientId: creds.clientId,
    username: creds.username,
    token: {
      access: 'old',
      accessExpiresAt: past,
      refresh: 'refresh-1',
      refreshExpiresAt: past + 1e6,
    },
  });
  const { tv, client } = await setup({ store });
  await client.connect();
  assert.equal(tv.attempts[0].password, 'refresh-1');
  const request = tv.published.find(({ topic }) => topic.endsWith('/data/gettoken'));
  assert.deepEqual(JSON.parse(request.payload), { refreshtoken: 'refresh-1' });
  client.disconnect();
});

test('tokensFromIssuance computes the expiry dates', () => {
  const tokens = tokensFromIssuance(
    {
      accesstoken: 'a',
      accesstoken_time: 1000,
      accesstoken_duration_day: 1,
      refreshtoken: 'r',
      refreshtoken_time: 1000,
      refreshtoken_duration_day: 2,
    },
    5,
  );
  assert.deepEqual(tokens, {
    access: 'a',
    accessExpiresAt: 1000 + 86400,
    refresh: 'r',
    refreshExpiresAt: 1000 + 2 * 86400,
  });
});
