// -----------------------------------------------------------------------------
// MQTT credentials of a Hisense VIDAA TV.
//
// The TV runs an MQTT broker (port 36669, TLS). Older firmware accepts a fixed
// login; newer firmware checks credentials derived from the client identifier
// and the current time, the way the official "VIDAA" / "RemoteNOW" mobile app
// builds them. The algorithm comes from the community reverse engineering of
// the app (pyvidaa, MIT licensed: https://github.com/warrenrees/myhisense-tv).
//
// Which variant a TV expects depends on its "transport protocol" version:
//   static : very old firmware, fixed login hisenseservice / multimqttservice
//   legacy : dynamic credentials, plain timestamp in the username
//   middle : dynamic credentials, XOR-ed timestamp (protocol 3000-3285)
//   modern : XOR-ed timestamp, new password suffix (protocol >= 3290)
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export const AUTH_METHODS = Object.freeze({
  MODERN: 'modern',
  MIDDLE: 'middle',
  LEGACY: 'legacy',
  STATIC: 'static',
});

// Constants of the official app's native library (libmqttcrypt.so).
const PATTERN = '38D65DC30F45109A369A86FCE866A85B';
const VALUE_SUFFIX_MODERN = 'h!i@s#$v%i^d&a*a';
const VALUE_SUFFIX_LEGACY = 'h*i&s%e!r^v0i1c9';
const TIME_XOR_CONSTANT = 0x56981477_2b03a968n;

export const STATIC_USERNAME = 'hisenseservice';
export const STATIC_PASSWORD = 'multimqttservice';

const DEFAULT_BRAND = 'his';
const DEFAULT_OPERATION = 'vidaacommon';

function md5Upper(text) {
  return createHash('md5').update(text, 'utf8').digest('hex').toUpperCase();
}

function sumDigits(value) {
  return String(Math.abs(value))
    .split('')
    .reduce((sum, digit) => sum + Number(digit), 0);
}

/**
 * Order in which the methods are tried when the user lets the integration
 * detect it ("auto"): the most common one on current TVs first, the fixed
 * login last.
 */
export function authMethodOrder(preferred = 'auto') {
  const all = [AUTH_METHODS.MODERN, AUTH_METHODS.MIDDLE, AUTH_METHODS.LEGACY, AUTH_METHODS.STATIC];
  if (!all.includes(preferred)) {
    return all;
  }
  return [preferred, ...all.filter((method) => method !== preferred)];
}

/**
 * Build the MQTT credentials for a method.
 *
 * @param {object} options
 * @param {string} options.uuid    identifier of this remote, MAC formatted
 *   ("aa:bb:cc:dd:ee:ff"). The TV authorizes it once the PIN is entered, so it
 *   must stay stable: it is generated once and stored (see store.js).
 * @param {string} [options.method] one of AUTH_METHODS
 * @param {number} [options.timestamp] Unix time in SECONDS (default: now)
 * @returns {{ clientId: string, username: string, password: string }}
 */
export function generateCredentials({
  uuid,
  method = AUTH_METHODS.MODERN,
  timestamp = Math.floor(Date.now() / 1000),
  brand = DEFAULT_BRAND,
  operation = DEFAULT_OPERATION,
}) {
  if (!uuid) {
    throw new Error('A client uuid is required to build VIDAA credentials');
  }

  // The fixed login: the TV authorizes the client id itself, which is the uuid.
  if (method === AUTH_METHODS.STATIC) {
    return { clientId: uuid, username: STATIC_USERNAME, password: STATIC_PASSWORD };
  }

  // The hash is case-sensitive: the uuid is used exactly as stored.
  const race = md5Upper(`${PATTERN}$${uuid}`).slice(0, 6);
  const clientId = `${uuid}$${brand}$${race}_${operation}_001`;

  const username =
    method === AUTH_METHODS.LEGACY
      ? `${brand}$${timestamp}`
      : `${brand}$${BigInt(timestamp) ^ TIME_XOR_CONSTANT}`;

  const suffix = method === AUTH_METHODS.MODERN ? VALUE_SUFFIX_MODERN : VALUE_SUFFIX_LEGACY;
  const value = md5Upper(`${brand}${sumDigits(timestamp) % 10}${suffix}`).slice(0, 6);
  const password = md5Upper(`${timestamp}$${value}`);

  return { clientId, username, password };
}
