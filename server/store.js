/**
 * Storage layer.
 *
 * Two interchangeable backends behind one tiny collection API:
 *
 *   • `DATABASE_URL` set  → PostgreSQL (Railway, Supabase, anything)
 *   • otherwise           → a JSON file under ./data (zero setup, `npm run dev` just works)
 *
 * Both keep documents as JSON, so business logic never branches on the backend.
 * Filtering and sorting happen in JS — right call at workspace scale (tens of
 * users, thousands of tasks). If tasks ever grow past ~100k, move the hot
 * queries into SQL against the `data` jsonb column, which is already indexed.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'workspace.json');

export const COLLECTIONS = [
  'users',
  'apps',
  'tasks',
  'comments',
  'notifications',
  'activity',
  'pushSubscriptions',
  'settings',
];

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

/* ------------------------------------------------------------------ */
/* JSON file backend                                                    */
/* ------------------------------------------------------------------ */

class FileStore {
  constructor() {
    this.cache = null;
    this.writing = Promise.resolve();
  }

  async init() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      const raw = await fs.readFile(DATA_FILE, 'utf8');
      this.cache = JSON.parse(raw);
    } catch {
      this.cache = {};
    }
    for (const c of COLLECTIONS) if (!this.cache[c]) this.cache[c] = [];
    await this.flush();
    return this;
  }

  /** Serialised, atomic write — a crash mid-save can't truncate the store. */
  flush() {
    this.writing = this.writing.then(async () => {
      const tmp = `${DATA_FILE}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), 'utf8');
      await fs.rename(tmp, DATA_FILE);
    });
    return this.writing;
  }

  async all(collection) {
    return structuredClone(this.cache[collection] ?? []);
  }

  async get(collection, id) {
    const hit = (this.cache[collection] ?? []).find((d) => d.id === id);
    return hit ? structuredClone(hit) : null;
  }

  async insert(collection, doc) {
    this.cache[collection].push(doc);
    await this.flush();
    return structuredClone(doc);
  }

  async update(collection, id, patch) {
    const list = this.cache[collection] ?? [];
    const i = list.findIndex((d) => d.id === id);
    if (i === -1) return null;
    list[i] = { ...list[i], ...patch, id, updatedAt: now() };
    await this.flush();
    return structuredClone(list[i]);
  }

  async remove(collection, id) {
    const list = this.cache[collection] ?? [];
    const i = list.findIndex((d) => d.id === id);
    if (i === -1) return false;
    list.splice(i, 1);
    await this.flush();
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* PostgreSQL backend                                                   */
/* ------------------------------------------------------------------ */

class PgStore {
  constructor(url) {
    this.url = url;
  }

  async init() {
    const { default: pg } = await import('pg');
    this.pool = new pg.Pool({
      connectionString: this.url,
      // Railway / Supabase / Heroku all terminate TLS with their own CA.
      ssl: /localhost|127\.0\.0\.1/.test(this.url) ? false : { rejectUnauthorized: false },
      max: 8,
    });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS documents (
        collection text NOT NULL,
        id         text NOT NULL,
        data       jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (collection, id)
      );
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS documents_data_idx ON documents USING gin (data jsonb_path_ops);`
    );
    return this;
  }

  async all(collection) {
    const { rows } = await this.pool.query(
      'SELECT data FROM documents WHERE collection = $1',
      [collection]
    );
    return rows.map((r) => r.data);
  }

  async get(collection, id) {
    const { rows } = await this.pool.query(
      'SELECT data FROM documents WHERE collection = $1 AND id = $2',
      [collection, id]
    );
    return rows[0]?.data ?? null;
  }

  async insert(collection, doc) {
    await this.pool.query(
      `INSERT INTO documents (collection, id, data) VALUES ($1, $2, $3)
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [collection, doc.id, doc]
    );
    return doc;
  }

  async update(collection, id, patch) {
    const current = await this.get(collection, id);
    if (!current) return null;
    const next = { ...current, ...patch, id, updatedAt: now() };
    await this.pool.query(
      'UPDATE documents SET data = $3, updated_at = now() WHERE collection = $1 AND id = $2',
      [collection, id, next]
    );
    return next;
  }

  async remove(collection, id) {
    const { rowCount } = await this.pool.query(
      'DELETE FROM documents WHERE collection = $1 AND id = $2',
      [collection, id]
    );
    return rowCount > 0;
  }
}

/* ------------------------------------------------------------------ */

let store = null;

export async function getStore() {
  if (store) return store;
  store = process.env.DATABASE_URL
    ? await new PgStore(process.env.DATABASE_URL).init()
    : await new FileStore().init();
  store.kind = process.env.DATABASE_URL ? 'postgres' : 'file';
  return store;
}

/** Insert with the id/timestamps every document in this app carries. */
export async function create(collection, doc) {
  const s = await getStore();
  const stamped = { id: doc.id || newId(), createdAt: now(), updatedAt: now(), ...doc };
  return s.insert(collection, stamped);
}

export async function find(collection, predicate) {
  const s = await getStore();
  const list = await s.all(collection);
  return predicate ? list.filter(predicate) : list;
}

export async function findOne(collection, predicate) {
  const list = await find(collection, predicate);
  return list[0] ?? null;
}
