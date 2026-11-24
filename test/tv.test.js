import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig, configProblem } from '../src/config.js';
import { buildTelevisionDevice, BUTTON_FEATURES, FEATURE } from '../src/devices/television.js';
import { createTvController, describeError } from '../src/tv.js';
import { VidaaClient } from '../src/vidaa/client.js';
import { ACTIONS } from '../src/actions.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { createFakeTv, tempStore, tick } from './helpers.js';

const config = normalizeConfig({
  tv_host: '192.168.1.50',
  tv_mac: 'AA-BB-CC-DD-EE-FF',
  tv_name: 'Living room TV',
});

const SOURCES = [
  { sourceid: '0', sourcename: 'TV', displayname: 'TV' },
  { sourceid: '3', sourcename: 'HDMI1', displayname: 'PlayStation' },
];
const APPS = [
  { appId: '1', name: 'Netflix', url: 'netflix' },
  { appId: '3', name: 'YouTube', url: 'youtube' },
];

// A TV that answers the requests like a real one.
function respondingTv({ accept } = {}) {
  return createFakeTv({
    accept,
    onPublish: (topic, payload, tv) => {
      const id = topic.split('/')[4];
      const reply = (service, type, body) =>
        setImmediate(() => tv.send(`/remoteapp/mobile/${id}/${service}/data/${type}`, body));
      if (topic.endsWith('/actions/sourcelist')) reply('ui_service', 'sourcelist', SOURCES);
      if (topic.endsWith('/actions/applist')) reply('ui_service', 'applist', APPS);
      if (topic.endsWith('/actions/gettvstate'))
        reply('ui_service', 'state', { statetype: 'livetv' });
      if (topic.endsWith('/actions/getvolume')) {
        reply('platform_service', 'volume', { volume_type: 0, volume_value: 18 });
      }
    },
  });
}

async function setup({ tv = respondingTv(), conf = config } = {}) {
  const gladys = createFakeGladys();
  const store = await tempStore();
  const controller = createTvController({
    gladys,
    store,
    createClient: (options) =>
      new VidaaClient({
        ...options,
        connectFn: tv.connectFn,
        connectTimeoutMs: 200,
        responseTimeoutMs: 100,
      }),
  });
  await controller.configure(conf);
  return { gladys, store, controller, tv };
}

const featureId = (gladys, key) => `ext:test-integration:tv:aabbccddeeff:${key}`;
const statesOf = (gladys, key) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === featureId(gladys, key));

test('config: MAC normalized, problems reported in both languages', () => {
  assert.equal(config.tv_mac, 'aa:bb:cc:dd:ee:ff');
  assert.equal(configProblem(config), null);
  assert.ok(configProblem(normalizeConfig({ tv_mac: 'aa:bb:cc:dd:ee:ff' })).fr);
  assert.ok(configProblem(normalizeConfig({ tv_host: '10.0.0.2', tv_mac: 'nope' })).en);
  assert.ok(
    configProblem(normalizeConfig({ tv_host: 'h', tv_mac: 'aabbccddeeff', client_cert: 'X' })),
  );
  assert.equal(normalizeConfig({ auth_mode: 'weird' }).auth_mode, 'auto');
  assert.equal(normalizeConfig({ wol_broadcast: 'not an ip' }).wol_broadcast, '');
});

test('Gladys accepts the TV device, and every feature carries the mandatory columns', async () => {
  const gladys = createFakeGladys();
  const device = buildTelevisionDevice(gladys, config, { sources: SOURCES, apps: APPS });
  // The fake refuses what the host API refuses (unknown category, type...).
  await gladys.publishDiscoveredDevices([device]);
  assert.equal(gladys.fake.discoveredDevices.length, 1);

  assert.equal(device.external_id, 'ext:test-integration:tv:aabbccddeeff');
  assert.equal(device.name, 'Living room TV');
  assert.ok(Object.values(DEVICE_POLL_FREQUENCIES).includes(device.poll_frequency));
  for (const feature of device.features) {
    const where = feature.name;
    assert.ok(feature.name, `${where}: name`);
    assert.ok(Number.isFinite(feature.min) && Number.isFinite(feature.max), `${where}: min/max`);
    assert.ok(feature.min <= feature.max, `${where}: min <= max`);
    assert.equal(typeof feature.read_only, 'boolean', `${where}: read_only`);
    assert.equal(typeof feature.has_feedback, 'boolean', `${where}: has_feedback`);
  }
  const source = device.features.find((f) => f.external_id.endsWith(':source'));
  assert.deepEqual(
    source.supported_options.map((o) => [o.value, o.label]),
    [
      ['0', 'TV'],
      ['3', 'PlayStation'],
    ],
  );
});

test('without lists from the TV, the device still offers the usual sources and apps', () => {
  const device = buildTelevisionDevice(createFakeGladys(), config);
  const app = device.features.find((f) => f.external_id.endsWith(':app'));
  assert.ok(app.supported_options.some((o) => o.value === 'Netflix'));
});

test('refresh: TV on publishes power and volume, and loads its sources and apps', async () => {
  const { gladys, controller, store } = await setup();
  await controller.refresh();
  assert.deepEqual(statesOf(gladys, FEATURE.POWER).at(-1).state, 1);
  assert.deepEqual(statesOf(gladys, FEATURE.VOLUME).at(-1).state, 18);
  assert.deepEqual((await store.load()).lists.sources, SOURCES);
  // The device was republished with the real sources.
  const source = gladys.fake.discoveredDevices[0].features.find((f) =>
    f.external_id.endsWith(':source'),
  );
  assert.ok(source.supported_options.some((o) => o.label === 'PlayStation'));
  controller.stop();
});

test('refresh: TV off (unreachable) publishes power 0', async () => {
  const { gladys, controller } = await setup({ tv: respondingTv({ accept: () => 'unreachable' }) });
  await controller.refresh();
  assert.equal(statesOf(gladys, FEATURE.POWER).at(-1).state, 0);
  controller.stop();
});

test('standby broadcast and connection loss switch the power off', async () => {
  const { gladys, controller, tv } = await setup();
  await controller.refresh();
  tv.send('/remoteapp/mobile/broadcast/ui_service/state', { statetype: 'fake_sleep_0' });
  await tick();
  assert.equal(statesOf(gladys, FEATURE.POWER).at(-1).state, 0);
  tv.send('/remoteapp/mobile/broadcast/ui_service/state', {
    statetype: 'sourceswitch',
    sourceid: '3',
  });
  await tick();
  assert.equal(statesOf(gladys, FEATURE.POWER).at(-1).state, 1);
  assert.equal(statesOf(gladys, FEATURE.SOURCE).at(-1).text, '3');
  tv.drop();
  await tick();
  assert.equal(statesOf(gladys, FEATURE.POWER).at(-1).state, 0);
  controller.stop();
});

test('commands: buttons, volume, source and app reach the TV', async () => {
  const { gladys, controller, tv } = await setup();
  await controller.refresh();
  tv.published.length = 0;
  const feature = (key) => ({ external_id: featureId(gladys, key) });

  await controller.setValue(feature('volume-up'), 1);
  await controller.setValue(feature(FEATURE.VOLUME), 30);
  await controller.setValue(feature(FEATURE.SOURCE), '3');
  await controller.setValue(feature(FEATURE.APP), 'YouTube');

  const sent = tv.published.map(({ topic, payload }) => [topic.split('/').at(-1), payload]);
  assert.deepEqual(sent[0], ['sendkey', 'KEY_VOLUMEUP']);
  assert.deepEqual(sent[1], ['changevolume', '30']);
  assert.equal(sent[2][0], 'changesource');
  assert.equal(JSON.parse(sent[2][1]).sourceid, '3');
  assert.equal(sent[3][0], 'launchapp');
  assert.equal(JSON.parse(sent[3][1]).name, 'YouTube');
  assert.equal(statesOf(gladys, FEATURE.VOLUME).at(-1).state, 30);

  await assert.rejects(controller.setValue(feature(FEATURE.APP), 'Unknown'), /Unknown application/);
  await assert.rejects(controller.setValue(feature(FEATURE.SOURCE), '42'), /Unknown source/);
  controller.stop();
});

test('every button feature sends its remote key', async () => {
  const { gladys, controller, tv } = await setup();
  await controller.refresh();
  for (const button of BUTTON_FEATURES) {
    tv.published.length = 0;
    await controller.setValue({ external_id: featureId(gladys, button.key) }, 1);
    assert.deepEqual(
      tv.published.map(({ payload }) => payload),
      [button.tvKey],
    );
  }
  controller.stop();
});

test('power off sends the power key, power on from off uses Wake-on-LAN', async () => {
  const { gladys, controller, tv } = await setup();
  await controller.refresh();
  tv.published.length = 0;
  await controller.setValue({ external_id: featureId(gladys, FEATURE.POWER) }, 0);
  assert.deepEqual(
    tv.published.map(({ payload }) => payload),
    ['KEY_POWER'],
  );
  assert.equal(statesOf(gladys, FEATURE.POWER).at(-1).state, 0);

  // Still connected in standby: the power key wakes it up.
  tv.published.length = 0;
  await controller.setValue({ external_id: featureId(gladys, FEATURE.POWER) }, 1);
  assert.deepEqual(
    tv.published.map(({ payload }) => payload),
    ['KEY_POWER'],
  );
  controller.stop();

  // Unreachable: a magic packet through the Gladys core.
  const off = await setup({ tv: respondingTv({ accept: () => 'unreachable' }) });
  await off.controller.setValue({ external_id: featureId(off.gladys, FEATURE.POWER) }, 1);
  const wake = off.gladys.fake.requests.find((r) => r.path === '/network/wake');
  assert.ok(wake, 'a Wake-on-LAN request reached Gladys');
  assert.equal(wake.body.mac.toLowerCase().replace(/[^0-9a-f]/g, ''), 'aabbccddeeff');
  off.controller.stop();
});

test('actions answer with a message, errors included', async () => {
  const { controller } = await setup({ tv: respondingTv({ accept: () => 'unreachable' }) });
  const message = await ACTIONS.test_connection(controller, { fields: {} });
  assert.match(message.en, /does not answer/);
  assert.ok(message.fr);

  const unconfigured = await setup({ conf: normalizeConfig({}) });
  const missing = await ACTIONS.pair_start(unconfigured.controller, { fields: {} });
  assert.match(missing.en, /IP address/);
  controller.stop();
});

test('test_connection tells whether the TV accepts the commands', async () => {
  const { controller } = await setup();
  const message = await ACTIONS.test_connection(controller, { fields: {} });
  assert.match(message.en, /commands accepted/);
  assert.match(message.en, /Volume: 18/);
  controller.stop();
});

test('describeError points to the certificate on a TLS refusal', () => {
  assert.match(describeError(new Error('alert certificate required')).en, /certificate/);
  assert.match(describeError(new Error('EHOSTUNREACH')).en, /does not answer/);
});

test('scene actions send keys and open apps', async () => {
  const { controller, tv } = await setup();
  await controller.refresh();
  tv.published.length = 0;
  assert.deepEqual(
    await SCENE_ACTIONS.send_key(controller, { fields: { key: 'KEY_VOLUMEDOWN', repeat: 3 } }),
    { sent: true },
  );
  assert.equal(tv.published.length, 3);
  assert.deepEqual(await SCENE_ACTIONS.launch_app(controller, { fields: { app: 'netflix' } }), {
    app: 'Netflix',
  });
  await assert.rejects(SCENE_ACTIONS.send_key(controller, { fields: { key: 'rm -rf' } }));
  controller.stop();
});
