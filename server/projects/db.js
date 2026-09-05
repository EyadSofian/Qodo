/**
 * Qodo Projects — the relational half of the application.
 *
 * The workspace stores documents (`server/store.js`) and that remains the right
 * shape for it. Projects does not fit there, and `store.js` says so in its own
 * header: filtering in JavaScript is "right call at workspace scale… If tasks
 * ever grow past ~100k, move the hot queries into SQL". This module is that
 * move, scoped to Projects and nothing else. The reasoning is ADR-2 in
 * docs/QODO_PROJECTS_ARCHITECTURE.md; the short version is three things a
 * `jsonb` document cannot do:
 *
 *   • answer "the 50 open tasks in this project" without loading every task in
 *     the company and filtering them in Node;
 *   • refuse an UPDATE, which an append-only audit log requires;
 *   • hand back a row with the salary column left out, which field-level
 *     permissions require.
 *
 * Everything Projects owns lives in one schema, `qodo_projects`, so the honest
 * rollback for this entire module is one `DROP SCHEMA` and no workspace data is
 * touched.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export const SCHEMA = 'qodo_projects';

let pool = null;
let ready = null;
/** Why Projects is unavailable, in a form a route can put in a 503 body. */
let unavailableReason = null;

/**
 * Projects needs PostgreSQL and does not pretend otherwise.
 *
 * The rest of the workspace runs with zero setup against a JSON file, and that
 * stays true — `npm run dev` still works. But a JSON fallback *for Projects*
 * would mean writing every query twice, once in SQL and once as a JavaScript
 * filter, and the two would drift the first time somebody fixed a bug in one of
 * them. §83 forbids exactly that duplication. So without a database the
 * Projects routes answer 503 and say what to do about it, while every other
 * module carries on.
 */
export function isAvailable() {
  return Boolean(process.env.DATABASE_URL);
}

export function unavailable() {
  return {
    error: 'projects_storage_unavailable',
    reason: unavailableReason ?? 'DATABASE_URL is not set.',
    hint: 'docker run -d -e POSTGRES_PASSWORD=qodo -p 5432:5432 postgres:16, then set DATABASE_URL=postgres://postgres:qodo@localhost:5432/postgres',
  };
}

/**
 * Connect, create the schema, run migrations. Idempotent and memoised, so
 * Railway restarting the process on every deploy is safe and concurrent first
 * requests do not each start their own migration run.
 */
export async function init() {
  if (ready) return ready;
  if (!isAvailable()) {
    unavailableReason = 'DATABASE_URL is not set.';
    return null;
  }

  ready = (async () => {
    const { default: pg } = await import('pg');

    /**
     * A `date` column is a calendar day, not an instant.
     *
     * The driver's default is to parse one into a JavaScript `Date` at *local*
     * midnight, which then serialises to JSON in UTC — so on a server in Cairo
     * (UTC+2/+3) a task due 2026-09-13 reaches the browser as
     * "2026-09-12T21:00:00.000Z" and renders as the 12th. Every due date in the
     * product would have been a day early, and only for people east of
     * Greenwich, which is the worst way to find a bug.
     *
     * OID 1082 is `date`. Handing it back as the text PostgreSQL already stores
     * keeps a calendar day a calendar day from the column to the screen.
     */
    pg.types.setTypeParser(1082, (value) => value);

    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      // Same reasoning as store.js: Railway, Supabase and Heroku all terminate
      // TLS with their own CA.
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
        ? false
        : { rejectUnauthorized: false },
      max: 12,
      idleTimeoutMillis: 30_000,
    });

    /**
     * A pool with no `error` listener turns any idle-client failure into an
     * uncaught exception, which in Node means the process dies.
     *
     * That is not a test detail: a database restart, a failover, or a network
     * blip all error idle clients, and the API going down because PostgreSQL
     * blinked is a worse outcome than the request that was never made. The pool
     * discards the broken client and opens a new one on the next query, so the
     * right response is to say so and carry on.
     */
    pool.on('error', (error) => {
      console.error('[projects] idle database client errored —', error.message);
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
    // A failed migration must not leave a half-initialised pool behind that the
    // next request happily uses. Reset so a fixed deploy can retry cleanly.
    ready = null;
    pool = null;
    unavailableReason = error.message;
    throw error;
  }
}

/**
 * Apply every migration not yet applied, in filename order, each in its own
 * transaction.
 *
 * A migration whose checksum no longer matches what was applied is a hard
 * error, not a warning and not a silent skip. Editing an already-applied
 * migration is the mistake this catches: it leaves production on the old shape
 * while every developer's fresh database gets the new one, and nothing else in
 * the system would ever notice.
 */
async function migrate() {
  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query(
    `SELECT filename, checksum FROM ${SCHEMA}.schema_migrations`
  );
  const applied = new Map(rows.map((row) => [row.filename, row.checksum]));

  for (const filename of files) {
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const previous = applied.get(filename);

    if (previous) {
      if (previous !== checksum) {
        throw new Error(
          `[projects] migration ${filename} changed after it was applied. ` +
            `Migrations are forward-only — add a new file instead of editing this one.`
        );
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO ${SCHEMA}.schema_migrations (filename, checksum) VALUES ($1, $2)`,
        [filename, checksum]
      );
      await client.query('COMMIT');
      console.log(`[projects] applied ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`[projects] migration ${filename} failed: ${error.message}`);
    } finally {
      client.release();
    }
  }
}

/** One statement. Parameterised — there is no string-concatenation path here. */
export async function query(text, params = []) {
  const client = await init();
  if (!client) throw Object.assign(new Error('projects_storage_unavailable'), { code: 'projects_storage_unavailable' });
  return client.query(text, params);
}

export async function rows(text, params = []) {
  return (await query(text, params)).rows;
}

export async function row(text, params = []) {
  return (await query(text, params)).rows[0] ?? null;
}

/**
 * Everything multi-row goes through here.
 *
 * Creating a project from a template writes a project, its phases, its task
 * lists, its tasks and their dependencies. Half of that is not a slow request,
 * it is corrupt data — a phase pointing at a project that does not exist. The
 * callback gets a client with the same `rows`/`row` helpers so a service reads
 * the same whether or not it is inside a transaction.
 */
export async function transaction(fn) {
  const client = await init();
  if (!client) throw Object.assign(new Error('projects_storage_unavailable'), { code: 'projects_storage_unavailable' });

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

/**
 * Build a `WHERE` clause from named conditions.
 *
 * Small on purpose. It exists so that `organization_id = $n` is added by the
 * same code path every time rather than by each caller remembering — the
 * tenant filter is the one condition that must never be forgotten, and a helper
 * that makes it the default is worth more than a general query builder.
 */
export function where(conditions) {
  const parts = [];
  const params = [];
  for (const [sql, value] of conditions) {
    if (value === undefined) continue;
    params.push(value);
    parts.push(sql.replace('?', `$${params.length}`));
  }
  return { clause: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

/**
 * Bounded pagination.
 *
 * §73 is explicit that a page must never load every task in the company, and
 * the cheapest way to guarantee that is to make an unbounded page impossible to
 * ask for: `limit` is clamped, and a caller who passes nothing gets 50 rather
 * than everything.
 */
export const MAX_PAGE = 200;

export function paginate(input = {}) {
  const limit = Math.min(MAX_PAGE, Math.max(1, Number(input.limit) || 50));
  const offset = Math.max(0, Number(input.offset) || 0);
  return { limit, offset };
}

/** Pool health, for tests that want to assert nothing leaked. */
export function poolStats() {
  if (!pool) return null;
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}

/** Closes the pool. Tests need this; the server never calls it. */
export async function close() {
  if (pool) await pool.end();
  pool = null;
  ready = null;
}
