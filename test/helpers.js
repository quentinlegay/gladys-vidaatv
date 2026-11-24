// -----------------------------------------------------------------------------
// Test helpers: an in-memory MQTT broker standing for the TV, and a temporary
// pairing store. Tests never touch the network.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore } from '../src/vidaa/store.js';

export async function tempStore() {
  return createStore(await mkdtemp(path.join(tmpdir(), 'vidaa-test-')));
}

/**
 * A fake TV. `connectFn` replaces mqtt.connect: each call opens a fake
 * connection that `accept(options)` decides to accept (true), refuse with a
 * CONNACK code (a number) or fail at the network level ('unreachable').
 * `onPublish(topic, payload, tv)` lets a test answer the commands.
 */
export function createFakeTv({ accept = () => true, onPublish = () => {} } = {}) {
  const tv = {
    attempts: [],
    published: [],
    subscriptions: [],
    current: null,
    connectFn(url, options) {
      const conn = new EventEmitter();
      conn.connected = false;
      conn.options = options;
      conn.url = url;
      conn.subscribe = (topics, opts, cb) => {
        tv.subscriptions.push(...topics);
        cb?.(null, []);
      };
      conn.publish = (topic, payload) => {
        tv.published.push({ topic, payload });
        onPublish(topic, payload, tv);
      };
      conn.end = () => {
        if (conn.connected) {
          conn.connected = false;
          conn.emit('close');
        }
      };
      tv.attempts.push(options);
      setImmediate(() => {
        const verdict = accept(options);
        if (verdict === true) {
          conn.connected = true;
          tv.current = conn;
          conn.emit('connect');
        } else if (verdict === 'unreachable') {
          const err = new Error('connect EHOSTUNREACH');
          err.code = 'EHOSTUNREACH';
          conn.emit('error', err);
        } else {
          const err = new Error('Connection refused: Not authorized');
          err.code = verdict;
          conn.emit('error', err);
        }
      });
      return conn;
    },
    /** The TV sends a message to the client. */
    send(topic, payload) {
      const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
      tv.current.emit('message', topic, Buffer.from(body));
    },
    /** The TV goes away. */
    drop() {
      tv.current?.end();
    },
  };
  return tv;
}

export const tick = () => new Promise((resolve) => setImmediate(resolve));
