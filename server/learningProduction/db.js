/**
 * E-Learning Production — storage.
 *
 * The module owns one PostgreSQL schema, `qodo_elearning_production`, and
 * nothing outside it. The honest rollback for the whole module is one
 * `DROP SCHEMA … CASCADE`, and no workspace, Projects or task data is touched
 * by it.
 *
 * The shape follows `server/projects/db.js` on purpose — pooled client,
 * forward-only checksummed migrations, one transaction helper — so a reader who
 * knows one module's storage knows the other's. It does not import that file:
 * this module shares the workspace's users, sessions and blob store, and
 * nothing of Projects.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export const SCHEMA = 'qodo_elearning_production';

let pool = null;
let ready = null;
let unavailableReason = null;

/** Without `DATABASE_URL` the module answers 503 and the rest of the workspace carries on. */
export function isAvailable() {
  return Boolean(process.env.DATABASE_URL);
}

export function unavailableBody() {
  return {
    error: {
      code: 'STORAGE_UNAVAILABLE',
      message: 'E-Learning Production needs its database. Ask an administrator to configure DATABASE_URL.',
      details: { reason: unavailableReason ?? 'DATABASE_URL is not set.' },
    },
  };
}

/** Connect, create the schema and apply migrations. Idempotent and memoised. */
export async function init() {
  if (ready) return ready;
  if (!isAvailable()) {
    unavailableReason = 'DATABASE_URL is not set.';
    return null;
  }

  ready = (async () => {
    const { default: pg } = await import('pg');

    // A `date` is a calendar day. Parsed into a JavaScript Date it becomes local
    // midnight, serialises in UTC, and a lesson due on the 13th reaches a Cairo
    // screen as the 12th. Keep the text PostgreSQL stores.
    pg.types.setTypeParser(1082, (value) => value);

    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
    });

    // An idle client erroring with no listener is an uncaught exception, and a
    // database restart should not take the API down with it.
    pool.on('error', (error) => {
      console.error('[learning-production] idle database client errored —', error.message);
    });

    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.schema_migrations (
        filename   text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await migrate();
    return pool;
  })();

  try {
    return await ready;
  } catch (error) {
    ready = null;
    if (pool) await pool.end().catch(() => {});
    pool = null;
    unavailableReason = error.message;
    throw error;
  }
}

/**
 * Apply each migration not yet applied, in filename order, one transaction
 * each. A migration edited after it was applied is a hard error: production
 * would keep the old shape while every fresh database got the new one.
 */
async function migrate() {
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  const { rows: appliedRows } = await pool.query(`SELECT filename, checksum FROM ${SCHEMA}.schema_migrations`);
  const applied = new Map(appliedRows.map((entry) => [entry.filename, entry.checksum]));

  for (const filename of files) {
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const previous = applied.get(filename);

    if (previous) {
      if (previous !== checksum) {
        throw new Error(
          `[learning-production] migration ${filename} changed after it was applied. Add a new migration instead.`
        );
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO ${SCHEMA}.schema_migrations (filename, checksum) VALUES ($1, $2)`, [
        filename,
        checksum,
      ]);
      await client.query('COMMIT');
      console.log(`[learning-production] applied ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`[learning-production] migration ${filename} failed: ${error.message}`);
    } finally {
      client.release();
    }
  }
}

function storageError() {
  return Object.assign(new Error('learning_storage_unavailable'), { code: 'LEARNING_STORAGE_UNAVAILABLE' });
}

/** One parameterised statement. There is no string-concatenation path for values. */
export async function query(text, params = []) {
  const client = await init();
  if (!client) throw storageError();
  return client.query(text, params);
}

export async function rows(text, params = []) {
  return (await query(text, params)).rows;
}

export async function row(text, params = []) {
  return (await query(text, params)).rows[0] ?? null;
}

/**
 * Multi-row changes. Creating a lesson writes the lesson and its five assets;
 * approving writes the decision, the asset and the activity entry. Half of any
 * of those is corrupt data, so all of them go through here.
 */
export async function transaction(fn) {
  const client = await init();
  if (!client) throw storageError();
  const connection = await client.connect();
  try {
    await connection.query('BEGIN');
    const tx = {
      query: (text, params = []) => connection.query(text, params),
      rows: async (text, params = []) => (await connection.query(text, params)).rows,
      row: async (text, params = []) => (await connection.query(text, params)).rows[0] ?? null,
    };
    const result = await fn(tx);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}

/** A reader that works both inside and outside a transaction. */
export const direct = { query, rows, row };

export function poolStats() {
  if (!pool) return null;
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}

/** Tests only. */
export async function close() {
  if (pool) await pool.end();
  pool = null;
  ready = null;
}
