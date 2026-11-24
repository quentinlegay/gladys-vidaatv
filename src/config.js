// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the `config_schema` of
// `gladys-assistant-integration.json`. This module only provides the defaults
// and normalizes the received object, so the rest of the code never deals with
// `undefined` or badly typed values.
// -----------------------------------------------------------------------------

import { normalizePem } from './vidaa/certs.js';
import { AUTH_METHODS } from './vidaa/credentials.js';

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  tv_host: '',
  tv_mac: '',
  tv_name: 'Hisense TV',
  auth_mode: 'auto',
  client_cert: '',
  client_key: '',
  wol_broadcast: '',
};

const AUTH_MODES = ['auto', ...Object.values(AUTH_METHODS)];

/** "AA-BB-CC-DD-EE-FF", "aabbccddeeff"... -> "aa:bb:cc:dd:ee:ff", or '' when invalid. */
export function normalizeMac(raw) {
  const hex = String(raw ?? '')
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) {
    return '';
  }
  return hex.match(/.{2}/g).join(':');
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const text = (key) => String(raw[key] ?? DEFAULT_CONFIG[key]).trim();
  const authMode = text('auth_mode');
  const broadcast = text('wol_broadcast');
  return {
    tv_host: text('tv_host'),
    tv_mac: normalizeMac(raw.tv_mac),
    tv_name: text('tv_name') || DEFAULT_CONFIG.tv_name,
    auth_mode: AUTH_MODES.includes(authMode) ? authMode : DEFAULT_CONFIG.auth_mode,
    client_cert: normalizePem(raw.client_cert, 'CERTIFICATE'),
    client_key: normalizePem(raw.client_key, 'PRIVATE KEY'),
    wol_broadcast: IPV4.test(broadcast) ? broadcast : '',
  };
}

/** What is missing before the integration can talk to the TV, or null. */
export function configProblem(config) {
  if (!config.tv_host) {
    return {
      en: 'Enter the IP address of the TV in the configuration.',
      fr: "Renseignez l'adresse IP du téléviseur dans la configuration.",
    };
  }
  if (!config.tv_mac) {
    return {
      en: 'Enter the MAC address of the TV in the configuration.',
      fr: "Renseignez l'adresse MAC du téléviseur dans la configuration.",
    };
  }
  if (Boolean(config.client_cert) !== Boolean(config.client_key)) {
    return {
      en: 'The client certificate and its private key go together: fill in both or neither.',
      fr: 'Le certificat client et sa clé privée vont ensemble : renseignez les deux ou aucun.',
    };
  }
  return null;
}
