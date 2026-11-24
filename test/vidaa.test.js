import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_METHODS,
  authMethodOrder,
  generateCredentials,
  STATIC_PASSWORD,
  STATIC_USERNAME,
} from '../src/vidaa/credentials.js';
import { normalizePem } from '../src/vidaa/certs.js';
import { generateUuid } from '../src/vidaa/store.js';
import { isSleepState, subscriptionTopics } from '../src/vidaa/protocol.js';
import { tempStore } from './helpers.js';

test('modern credentials match the values captured from the official app', () => {
  // Reference vector published with pyvidaa (logcat capture of the app).
  const creds = generateCredentials({ uuid: '56:b8:88:4e:f7:19', timestamp: 1766974704 });
  assert.deepEqual(creds, {
    clientId: '56:b8:88:4e:f7:19$his$256DBF_vidaacommon_001',
    username: 'his$6239759786168176024',
    password: 'C3BA44782E18ABF4892AC44D79A622D2',
  });
});

test('legacy credentials keep the plain timestamp, static ones the fixed login', () => {
  const legacy = generateCredentials({
    uuid: '56:b8:88:4e:f7:19',
    timestamp: 1766974704,
    method: AUTH_METHODS.LEGACY,
  });
  assert.equal(legacy.username, 'his$1766974704');
  assert.match(legacy.password, /^[0-9A-F]{32}$/);

  const middle = generateCredentials({
    uuid: '56:b8:88:4e:f7:19',
    timestamp: 1766974704,
    method: AUTH_METHODS.MIDDLE,
  });
  assert.equal(middle.username, 'his$6239759786168176024');
  // Middle shares the legacy password suffix; modern has its own.
  assert.equal(middle.password, legacy.password);
  assert.notEqual(middle.password, 'C3BA44782E18ABF4892AC44D79A622D2');

  assert.deepEqual(generateCredentials({ uuid: 'id', method: AUTH_METHODS.STATIC }), {
    clientId: 'id',
    username: STATIC_USERNAME,
    password: STATIC_PASSWORD,
  });
});

test('auto mode tries every method, the preferred one first', () => {
  assert.deepEqual(authMethodOrder(), ['modern', 'middle', 'legacy', 'static']);
  assert.deepEqual(authMethodOrder('legacy'), ['legacy', 'modern', 'middle', 'static']);
});

test('generated uuids are locally administered MAC addresses', () => {
  const uuid = generateUuid();
  assert.match(uuid, /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/);
  assert.equal(parseInt(uuid.slice(0, 2), 16) & 0x03, 0x02);
});

test('the store keeps the uuid across resets', async () => {
  const store = await tempStore();
  const uuid = await store.getUuid();
  await store.save({ method: 'modern', token: { access: 'secret' } });
  assert.equal(await store.getUuid(), uuid);
  await store.resetPairing();
  const data = await store.load();
  assert.deepEqual(data, { uuid });
});

const BODY = 'MIIBszCCAVmgAwIBAgIUQ0123456789abcdefABCDEF+/xyz==';

test('normalizePem rebuilds a PEM flattened by a single-line field', () => {
  const flat = `-----BEGIN CERTIFICATE----- ${BODY} -----END CERTIFICATE-----`;
  assert.equal(
    normalizePem(flat, 'CERTIFICATE'),
    `-----BEGIN CERTIFICATE-----\n${BODY}\n-----END CERTIFICATE-----\n`,
  );
});

test('normalizePem accepts a bare body, a base64-encoded file and nothing', () => {
  assert.equal(
    normalizePem(BODY, 'PRIVATE KEY'),
    `-----BEGIN PRIVATE KEY-----\n${BODY}\n-----END PRIVATE KEY-----\n`,
  );
  const file = `-----BEGIN RSA PRIVATE KEY-----\n${BODY}\n-----END RSA PRIVATE KEY-----\n`;
  assert.equal(normalizePem(Buffer.from(file).toString('base64'), 'PRIVATE KEY'), file);
  assert.equal(normalizePem('', 'CERTIFICATE'), undefined);
  assert.equal(normalizePem(undefined, 'CERTIFICATE'), undefined);
});

test('normalizePem keeps every block of a chain and wraps long lines', () => {
  const long = 'A'.repeat(100);
  const chain = `-----BEGIN CERTIFICATE-----${long}-----END CERTIFICATE----------BEGIN CERTIFICATE-----${BODY}-----END CERTIFICATE-----`;
  const pem = normalizePem(chain, 'CERTIFICATE');
  assert.equal(pem.match(/BEGIN CERTIFICATE/g).length, 2);
  assert.ok(pem.split('\n').every((line) => line.length <= 64));
});

test('subscriptions never use wildcards, and the sleep state is recognized', () => {
  // Some firmware refuses wildcard subscriptions.
  for (const topic of subscriptionTopics('client')) {
    assert.ok(!topic.includes('#') && !topic.includes('+'), topic);
  }
  assert.ok(isSleepState({ statetype: 'fake_sleep_0' }));
  assert.ok(!isSleepState({ statetype: 'livetv' }));
  assert.ok(!isSleepState(null));
});
