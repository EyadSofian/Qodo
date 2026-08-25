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
 *
 * Task deliverables are the one thing that does not fit a document: a 10 MB PDF
 * in workspace.json would be rewritten on every unrelated save, and in Postgres
 * it would sit inside a jsonb column that gets scanned by every query. So each
 * backend also carries a blob half — files on disk, or a `bytea` table — while
 * the file's *metadata* stays an ordinary document in `attachments`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'workspace.json');
const BLOB_DIR = path.join(DATA_DIR, 'uploads');

export const COLLECTIONS = [
  'organizations',
  'users',
  'invites',
  'apps',
  'tasks',
  // One row per HR catalogue template and organization. It says whether the
  // clock may generate it and who owns the generated work; the catalogue itself
  // remains versioned in code so every tenant runs the same audited plan.
  'hrTaskPlans',
  'taskAssignments',
  'comments',
  'attachments',
  'notifications',
  'activity',
  // Qodo Mail — one conversation model powers formal mail threads, channels
  // and direct chat. Membership is separate because read state belongs to a
  // person, not to the conversation itself.
  'mailConversations',
  'mailMemberships',
  'mailMessages',
  'mailAttachments',
  'mailAiRuns',
  // Qodo Calendar — meetings and appointments for the whole workspace. The
  // invite is its own document because a reply belongs to the person who gave
  // it, not to the event: an organizer editing the room must not silently
  // rewrite who had already accepted.
  'calendarEvents',
  'calendarInvites',
  'calendarAttachments',
  // The seating plan. A seat is its own document rather than an array on the
  // room for the reason a calendar invite is not an array on the event: who
  // sits on it changes independently of the room, moving two people at once
  // must not have one write overwrite the other, and the activity log needs a
  // subject id per seat to say who moved whom.
  'offices',
  'officeSeats',
  'pushSubscriptions',
  'settings',
  // The management desk — the executive's own tasks, meetings, appointments,
  // reminders and decisions. Separate from `tasks` on purpose: a task is a
  // contract assigned to somebody and measured, while these are the diary of
  // the people doing the assigning. `managementIngest` keeps every inbound
  // Telegram message whether or not the extraction worked, and
  // `managementMembers` is which chats are allowed to file at all.
  'managementItems',
  'managementIngest',
  'managementMembers',
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
    await fs.mkdir(BLOB_DIR, { recursive: true });
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

  /** Deterministic ids make scheduled writes safe to retry after a restart. */
  async insertIfAbsent(collection, doc) {
    const existing = (this.cache[collection] ?? []).find((item) => item.id === doc.id);
    if (existing) return { doc: structuredClone(existing), created: false };
    this.cache[collection].push(doc);
    await this.flush();
    return { doc: structuredClone(doc), created: true };
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

  /* Blobs live beside the JSON, one file each, named by the id we generated —
     never by anything the uploader chose, so a filename can't escape the dir. */

  async putBlob(id, bytes) {
    await fs.writeFile(path.join(BLOB_DIR, id), bytes);
  }

  async getBlob(id) {
    try {
      return await fs.readFile(path.join(BLOB_DIR, id));
    } catch {
      return null;
    }
  }

  async removeBlob(id) {
    await fs.rm(path.join(BLOB_DIR, id), { force: true });
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
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS blobs (
        id         text PRIMARY KEY,
        bytes      bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
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

  async insertIfAbsent(collection, doc) {
    const { rows } = await this.pool.query(
      `INSERT INTO documents (collection, id, data) VALUES ($1, $2, $3)
       ON CONFLICT (collection, id) DO NOTHING
       RETURNING data`,
      [collection, doc.id, doc]
    );
    if (rows[0]) return { doc: rows[0].data, created: true };
    return { doc: await this.get(collection, doc.id), created: false };
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

  async putBlob(id, bytes) {
    await this.pool.query(
      `INSERT INTO blobs (id, bytes) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET bytes = EXCLUDED.bytes`,
      [id, bytes]
    );
  }

  async getBlob(id) {
    const { rows } = await this.pool.query('SELECT bytes FROM blobs WHERE id = $1', [id]);
    return rows[0]?.bytes ?? null;
  }

  async removeBlob(id) {
    await this.pool.query('DELETE FROM blobs WHERE id = $1', [id]);
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

/**
 * Insert once and return the winner. Used by schedulers and webhook ingestion,
 * where a network retry is normal and must not become duplicate business data.
 */
export async function createIfAbsent(collection, doc) {
  if (!doc?.id) throw new Error('createIfAbsent requires a deterministic id');
  const s = await getStore();
  const stamped = { createdAt: now(), updatedAt: now(), ...doc };
  return s.insertIfAbsent(collection, stamped);
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

/* Blob half — bytes only. Whatever the bytes belong to is a document. */

export async function putBlob(id, bytes) {
  return (await getStore()).putBlob(id, bytes);
}

export async function getBlob(id) {
  return (await getStore()).getBlob(id);
}

export async function removeBlob(id) {
  return (await getStore()).removeBlob(id);
}
