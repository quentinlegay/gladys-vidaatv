// -----------------------------------------------------------------------------
// The Gladys device of the TV: its features and how a command on each one
// translates into the VIDAA protocol.
//
// The device external id is built from the MAC address of the TV, the one
// stable identifier the user gives us (the IP address can change). Feature
// keys are forever too: renaming one creates a new feature in Gladys.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { KEYS } from '../vidaa/protocol.js';

export const DEVICE_TYPE = 'tv';

const TV = DEVICE_FEATURE_TYPES.TELEVISION;

// Feature key -> remote key, for the "push button" features (value 1 = press).
export const BUTTON_FEATURES = Object.freeze([
  { key: 'volume-up', name: 'Volume up', type: TV.VOLUME_UP, tvKey: KEYS.VOLUME_UP },
  { key: 'volume-down', name: 'Volume down', type: TV.VOLUME_DOWN, tvKey: KEYS.VOLUME_DOWN },
  { key: 'mute', name: 'Mute', type: TV.VOLUME_MUTE, tvKey: KEYS.MUTE },
  { key: 'channel-up', name: 'Channel up', type: TV.CHANNEL_UP, tvKey: KEYS.CHANNEL_UP },
  { key: 'channel-down', name: 'Channel down', type: TV.CHANNEL_DOWN, tvKey: KEYS.CHANNEL_DOWN },
  { key: 'up', name: 'Up', type: TV.UP, tvKey: KEYS.UP },
  { key: 'down', name: 'Down', type: TV.DOWN, tvKey: KEYS.DOWN },
  { key: 'left', name: 'Left', type: TV.LEFT, tvKey: KEYS.LEFT },
  { key: 'right', name: 'Right', type: TV.RIGHT, tvKey: KEYS.RIGHT },
  { key: 'ok', name: 'OK', type: TV.ENTER, tvKey: KEYS.OK },
  { key: 'back', name: 'Back', type: TV.RETURN, tvKey: KEYS.BACK },
  { key: 'exit', name: 'Exit', type: TV.EXIT, tvKey: KEYS.EXIT },
  { key: 'menu', name: 'Menu', type: TV.MENU, tvKey: KEYS.MENU },
  { key: 'home', name: 'Home', type: TV.TOOLS, tvKey: KEYS.HOME },
  { key: 'info', name: 'Info', type: TV.INFO, tvKey: KEYS.INFO },
  { key: 'play', name: 'Play', type: TV.PLAY, tvKey: KEYS.PLAY },
  { key: 'pause', name: 'Pause', type: TV.PAUSE, tvKey: KEYS.PAUSE },
  { key: 'stop', name: 'Stop', type: TV.STOP, tvKey: KEYS.STOP },
  { key: 'rewind', name: 'Rewind', type: TV.REWIND, tvKey: KEYS.REWIND },
  { key: 'forward', name: 'Fast forward', type: TV.FORWARD, tvKey: KEYS.FORWARD },
]);

export const FEATURE = Object.freeze({
  POWER: 'power',
  VOLUME: 'volume',
  SOURCE: 'source',
  APP: 'app',
});

// Used until the TV answered once with its own lists (it may be off when the
// device is first published). Source ids follow the common VIDAA numbering.
export const DEFAULT_SOURCES = Object.freeze([
  { sourceid: '0', sourcename: 'TV', displayname: 'TV' },
  { sourceid: '3', sourcename: 'HDMI1', displayname: 'HDMI 1' },
  { sourceid: '4', sourcename: 'HDMI2', displayname: 'HDMI 2' },
  { sourceid: '5', sourcename: 'HDMI3', displayname: 'HDMI 3' },
  { sourceid: '6', sourcename: 'HDMI4', displayname: 'HDMI 4' },
  { sourceid: '1', sourcename: 'AV', displayname: 'AV' },
]);

export const DEFAULT_APPS = Object.freeze([
  { appId: '1', name: 'Netflix', url: 'netflix' },
  { appId: '3', name: 'YouTube', url: 'youtube' },
  { appId: '2', name: 'Prime Video', url: 'amazon' },
  { appId: '', name: 'Disney+', url: 'disneyplus' },
]);

// Gladys caps the options of a select: keep the list readable.
const MAX_OPTIONS = 50;

/** The value a source is selected by: its id. */
export const sourceValue = (source) => String(source.sourceid);
const sourceLabel = (source) =>
  String(source.displayname || source.sourcename || `Source ${source.sourceid}`);

/** The value an app is selected by: its name, the one field every firmware sends. */
export const appValue = (app) => String(app.name);

function uniqueOptions(items, valueOf, labelOf) {
  const seen = new Set();
  const options = [];
  for (const item of items) {
    const value = valueOf(item);
    if (!value || seen.has(value) || options.length >= MAX_OPTIONS) {
      continue;
    }
    seen.add(value);
    options.push({ value, label: labelOf(item), sort_order: options.length });
  }
  return options;
}

export function deviceIds(gladys, config) {
  return gladys.externalIds(DEVICE_TYPE, config.tv_mac.replace(/:/g, ''));
}

const base = { min: 0, max: 0, read_only: false, has_feedback: false, keep_history: false };

/**
 * Discovery payload of the TV.
 * @param {object} lists `{ sources, apps }` known from the TV (or the defaults)
 */
export function buildTelevisionDevice(gladys, config, lists = {}) {
  const ids = deviceIds(gladys, config);
  const sources = lists.sources?.length ? lists.sources : DEFAULT_SOURCES;
  const apps = lists.apps?.length ? lists.apps : DEFAULT_APPS;
  return {
    name: config.tv_name,
    external_id: ids.device,
    model: 'Hisense VIDAA',
    // Gladys polls the TV to notice it was switched on or off from its own
    // remote (see refresh() in src/tv.js). Explicit should_poll for the
    // older cores, which need both fields.
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_30_SECONDS,
    should_poll: true,
    params: [
      { name: 'IP_ADDRESS', value: config.tv_host },
      { name: 'MAC_ADDRESS', value: config.tv_mac },
    ],
    features: [
      {
        ...base,
        name: 'Power',
        external_id: ids.feature(FEATURE.POWER),
        category: DEVICE_FEATURE_CATEGORIES.TELEVISION,
        type: TV.BINARY,
        max: 1,
        has_feedback: true,
        keep_history: true,
      },
      {
        ...base,
        name: 'Volume',
        external_id: ids.feature(FEATURE.VOLUME),
        category: DEVICE_FEATURE_CATEGORIES.TELEVISION,
        type: TV.VOLUME,
        max: 100,
        has_feedback: true,
      },
      ...BUTTON_FEATURES.map((button) => ({
        ...base,
        name: button.name,
        external_id: ids.feature(button.key),
        category: DEVICE_FEATURE_CATEGORIES.TELEVISION,
        type: button.type,
        max: 1,
      })),
      {
        ...base,
        name: 'Source',
        external_id: ids.feature(FEATURE.SOURCE),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
        has_feedback: true,
        supported_options: uniqueOptions(sources, sourceValue, sourceLabel),
      },
      {
        ...base,
        name: 'Application',
        external_id: ids.feature(FEATURE.APP),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
        supported_options: uniqueOptions(apps, appValue, appValue),
      },
    ],
  };
}

/** Feature key of a feature external id of this device, or undefined. */
export function featureKeyOf(gladys, config, featureExternalId) {
  const prefix = deviceIds(gladys, config).feature('');
  return featureExternalId.startsWith(prefix) ? featureExternalId.slice(prefix.length) : undefined;
}
