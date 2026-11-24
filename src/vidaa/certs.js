// -----------------------------------------------------------------------------
// Client certificate of the mutual TLS handshake.
//
// Recent VIDAA firmware only accepts the TLS connection of a client presenting
// the certificate of the official mobile app. It is not shipped with this
// integration: the user pastes it (and its private key) in the configuration.
//
// A single-line form field flattens the PEM line breaks, and some users paste
// the bare base64 body: rebuild a well-formed PEM block from whatever arrives.
// -----------------------------------------------------------------------------

const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;

function wrap(label, base64Body) {
  const body = base64Body.replace(/[^A-Za-z0-9+/=]/g, '');
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

/**
 * Normalize a pasted PEM value.
 *
 * @param {string|undefined} raw value from the configuration
 * @param {string} defaultLabel label used when the value has no PEM header
 *   ("CERTIFICATE" or "PRIVATE KEY")
 * @returns {string|undefined} a PEM string, or undefined when empty
 */
export function normalizePem(raw, defaultLabel) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }
  const text = raw.trim();
  const blocks = [...text.matchAll(PEM_BLOCK)];
  if (blocks.length > 0) {
    // A certificate chain keeps all its blocks, in order.
    return blocks.map(([, label, body]) => wrap(label, body)).join('');
  }
  // No header: a base64 body, or a whole PEM file encoded in base64.
  const compact = text.replace(/\s+/g, '');
  try {
    const decoded = Buffer.from(compact, 'base64').toString('utf8');
    if (decoded.includes('-----BEGIN ')) {
      return normalizePem(decoded, defaultLabel);
    }
  } catch {
    // Not base64: fall through, the TLS layer reports the error.
  }
  return wrap(defaultLabel, compact);
}
