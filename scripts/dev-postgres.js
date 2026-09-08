/**
 * A PostgreSQL for local Projects work, without installing one.
 *
 * Qodo Projects needs a real database (ADR-2) and the README's answer is
 * `docker run postgres:16`. That is the right answer on a machine with Docker.
 * On one without it, the alternative was "install PostgreSQL" — which is enough
 * friction that, in practice, people work on Projects against no database at
 * all and find out what broke later.
 *
 * The test suite already solved this: `embedded-postgres` is a dev dependency
 * and `server/projects/testDatabase.js` starts a real cluster from it. This is
 * the same trick pointed at a *persistent* directory so a dev session survives
 * a restart, which is the one thing the test harness deliberately does not do.
 *
 *   node scripts/dev-postgres.js
 *
 * It prints the `DATABASE_URL` to paste into `.env.local`, then stays in the
 * foreground until Ctrl-C. Data lives in `data/dev-postgres/`, which is already
 * git-ignored along with the rest of `data/`.
 *
 * This is a development tool. It is not wired into `npm start`, it is not
 * imported by the server, and nothing in `server/` knows it exists.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, 'data', 'dev-postgres');

// Deliberately not 5432: a developer who *does* have a local PostgreSQL should
// not have this quietly fail to bind, or worse, appear to work while they are
// actually talking to their own server.
const PORT = Number(process.env.DEV_PG_PORT || 55432);
const DATABASE = 'qodo_dev';
const USER = 'qodo';
const PASSWORD = 'qodo';

const url = `postgres://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DATABASE}`;

async function main() {
  let EmbeddedPostgres;
  try {
    // Transpiled CommonJS behind an interop default, so the class sits one
    // level deeper than the import suggests — same unwrapping as testDatabase.js.
    const module = await import('embedded-postgres');
    EmbeddedPostgres = module.default?.default ?? module.default ?? module;
  } catch {
    console.error(
      'embedded-postgres is not installed. Run `npm install` first, or use the\n' +
        'Docker one-liner in the README instead.'
    );
    process.exit(1);
  }

  await fs.mkdir(DATA_DIR, { recursive: true });

  const server = new EmbeddedPostgres({
    // snake_case: the package does not camelCase its options, and a misspelled
    // key here is silently ignored rather than rejected — which lands the
    // cluster in the default ./data/db and collides with the test harness.
    database_dir: path.join(DATA_DIR, 'cluster'),
    user: USER,
    password: PASSWORD,
    port: PORT,
    // The whole point: the cluster is still there tomorrow morning.
    persistent: true,
  });

  // `initialise` on an already-initialised directory throws. That is the normal
  // case on every run after the first, so it is expected rather than an error.
  let firstRun = false;
  try {
    await server.initialise();
    firstRun = true;
  } catch {
    /* already initialised */
  }

  await server.start();

  try {
    await server.createDatabase(DATABASE);
  } catch {
    /* already exists */
  }

  const line = '─'.repeat(64);
  console.log(`\n${line}`);
  console.log('  PostgreSQL is running for Qodo Projects');
  console.log(`  ${firstRun ? 'Created a new cluster in' : 'Reusing the cluster in'} ${path.relative(ROOT, DATA_DIR)}`);
  console.log('');
  console.log('  Add this line to .env.local, then run `npm run dev`:');
  console.log('');
  console.log(`    DATABASE_URL=${url}`);
  console.log('');
  console.log('  Ctrl-C stops the server. The data stays.');
  console.log(`${line}\n`);

  const stop = async (signal) => {
    console.log(`\n[dev-postgres] ${signal} — shutting down…`);
    try {
      await server.stop();
    } catch {
      /* it is going away regardless */
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));

  // Hold the event loop open. `server.start()` resolves once the cluster is up;
  // without this the process would exit and take the cluster with it.
  setInterval(() => {}, 1 << 30);
}

main().catch((error) => {
  console.error('[dev-postgres]', error);
  process.exit(1);
});
