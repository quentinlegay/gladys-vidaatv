// -----------------------------------------------------------------------------
// Persistent state of the pairing, under /data (the only writable volume of the
// container): the uuid this remote uses, the authentication method that
// worked, and the tokens the TV issued after the PIN.
//
// Never logged: the tokens are credentials.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_DATA_DIR = process.env.DATA_DIR || '/data';
const FILE_NAME = 'vidaa-pairing.json';

/**
 * A random, locally administered unicast MAC address ("02:xx:..."): the TV
 * expects the remote identifier in MAC format, and a locally administered one
 * cannot collide with real hardware.
 */
export function generateUuid() {
  const bytes = randomBytes(6);
  bytes[0] = (bytes[0] & 0xfc) | 0x02;
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(':');
}

export function createStore(dataDir = DEFAULT_DATA_DIR) {
  const file = path.join(dataDir, FILE_NAME);
  let cache;

  async function load() {
    if (cache) {
      return cache;
    }
    try {
      cache = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      cache = {};
    }
    return cache;
  }

  async function save(patch) {
    const current = await load();
    cache = { ...current, ...patch };
    await mkdir(dataDir, { recursive: true });
    // Write then rename: a crash mid-write never leaves a truncated file.
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
    await rename(tmp, file);
    return cache;
  }

  return {
    load,
    save,
    /** The uuid of this remote, created on first use. */
    async getUuid() {
      const data = await load();
      if (data.uuid) {
        return data.uuid;
      }
      const uuid = generateUuid();
      await save({ uuid });
      return uuid;
    },
    /** Forget the tokens and the method (e.g. the TV changed). Keeps the uuid. */
    async resetPairing() {
      const data = await load();
      cache = { uuid: data.uuid };
      return save({});
    },
  };
}
