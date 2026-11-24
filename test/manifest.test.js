// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/actions.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { AUTH_METHODS } from '../src/vidaa/credentials.js';
import { ALL_KEY_NAMES } from '../src/vidaa/protocol.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[...(manifest.actions ?? []), ...(manifest.scene_actions ?? [])].flatMap(
    (item) => item.fields ?? [],
  ),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Minimum version of the manifest `gladys_version` range, e.g. [5, 1, 0].
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('every manifest action has a handler, and vice versa', () => {
  const declared = keysOf(manifest.actions);
  for (const key of declared) {
    assert.equal(typeof ACTIONS[key], 'function', `manifest action "${key}" has no handler`);
  }
  for (const key of Object.keys(ACTIONS)) {
    assert.ok(declared.includes(key), `handler "${key}" is not declared in actions`);
  }
});

test('every scene_actions key has an onSceneAction handler, and vice versa', () => {
  const declared = keysOf(manifest.scene_actions);
  for (const key of declared) {
    assert.equal(typeof SCENE_ACTIONS[key], 'function', `scene action "${key}" has no handler`);
  }
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.ok(declared.includes(key), `handler "${key}" is not declared in scene_actions`);
  }
});

test('the keys offered to scenes are keys the TV knows', () => {
  const field = manifest.scene_actions
    .find((action) => action.key === 'send_key')
    .fields.find((f) => f.key === 'key');
  for (const option of field.options) {
    assert.ok(ALL_KEY_NAMES.includes(option.value), `unknown key ${option.value}`);
  }
});

test('the authentication methods of the form are the ones the client knows', () => {
  const field = manifest.config_schema.find((f) => f.key === 'auth_mode');
  assert.deepEqual(
    field.options.map((o) => o.value),
    ['auto', ...Object.values(AUTH_METHODS)],
  );
});

test('categories require Gladys >= 4.86.0, scene actions >= 5.1.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  const required = manifest.scene_actions ? [5, 1, 0] : [4, 86, 0];
  assert.ok(
    isAtLeast(minGladysVersion(), required),
    `gladys_version must start at ${required.join('.')} or later, got "${manifest.gladys_version}"`,
  );
});

test('Wake-on-LAN is declared: powering the TV on depends on it', () => {
  // An undeclared access is a 403 on gladys.wakeOnLan().
  assert.equal(manifest.network_wake, true);
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `DEFAULT_CONFIG misses "${field.key}"`);
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(section.placeholder, undefined, `section "${section.key}": no placeholder`);
    assert.ok(section.label?.en, `section "${section.key}" needs an English label`);
    assert.ok(!(section.key in DEFAULT_CONFIG), `section "${section.key}" stores no value`);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('secrets have no default', () => {
  for (const field of manifest.config_schema.filter((f) => f.type === 'secret')) {
    assert.equal(field.default, undefined, `secret "${field.key}" must not have a default`);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  // The Release workflow writes all three: a mismatch means one was edited by
  // hand, and Gladys would offer a version whose image is another one.
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  assert.ok(manifest.description.en, 'the description needs an English text');
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('every text is bilingual, placeholders included', () => {
  const texts = [
    manifest.description,
    ...allFields.flatMap((f) => [f.label, f.description, f.placeholder]),
    ...allFields.flatMap((f) => (f.options ?? []).map((o) => o.label)),
    ...[...manifest.actions, ...manifest.scene_actions].flatMap((a) => [a.label, a.description]),
    ...manifest.scene_actions.flatMap((a) => (a.outputs ?? []).map((o) => o.label)),
  ].filter((text) => text !== undefined);
  for (const text of texts) {
    assert.equal(typeof text, 'object', `plain string text: ${text}`);
    assert.ok(text.en && text.fr, `missing translation: ${JSON.stringify(text)}`);
  }
});
