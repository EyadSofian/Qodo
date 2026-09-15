/**
 * Bytes for production files.
 *
 * Stored through the workspace's blob store (`server/store.js`) — files on disk
 * locally, a `bytea` table on PostgreSQL — under a generated key, never a name
 * the uploader chose.
 *
 * Audio and video are read many times in small pieces: a browser seeking
 * through a voice-over sends a Range request for every jump. Reading a 200 MB
 * blob out of the store for each of those would be the slowest thing in the
 * product, so recently played files are kept in a bounded in-process cache.
 * The budget is configurable and the cache is only an accelerator — every
 * request is still authorized before a single byte is served.
 */

import crypto from 'node:crypto';
import { getBlob, putBlob, removeBlob } from '../store.js';

const BUDGET = Math.max(0, Number(process.env.LEARNING_PRODUCTION_MEDIA_CACHE_MB ?? 256)) * 1024 * 1024;
const cache = new Map();
let cachedBytes = 0;

export function newStorageKey() {
  return `lp_${crypto.randomUUID()}`;
}

export async function store(bytes) {
  const key = newStorageKey();
  await putBlob(key, bytes);
  return key;
}

export async function discard(key) {
  if (!key) return;
  cache.delete(key);
  await removeBlob(key).catch(() => {});
}

export async function load(key) {
  const hit = cache.get(key);
  if (hit) {
    // Re-insert so Map order doubles as recency order.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const bytes = await getBlob(key);
  if (!bytes) return null;
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (BUDGET > 0 && buffer.length <= BUDGET / 2) {
    cache.set(key, buffer);
    cachedBytes += buffer.length;
    for (const [oldest, value] of cache) {
      if (cachedBytes <= BUDGET) break;
      cache.delete(oldest);
      cachedBytes -= value.length;
    }
  }
  return buffer;
}

export function checksum(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * A satisfiable byte range for a `Range: bytes=a-b` header, or `null` for the
 * whole file, or `'invalid'` when it cannot be served. Only single ranges —
 * media elements never ask for more.
 */
export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return 'invalid';
  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!suffix) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'invalid';
  return { start, end };
}
