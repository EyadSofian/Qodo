/**
 * A PostgreSQL for the Projects tests.
 *
 * The security properties this module rests on — tenant isolation, the client
 * boundary, an audit log the database itself refuses to rewrite — are all
 * *PostgreSQL* behaviour. They cannot be checked against an in-memory emulator,
 * because an emulator that does not run triggers will happily let you update a
 * row the real trigger would have refused, and report a pass.
 *
 * So the tests need a real server, and asking every developer to install one
 * before `npm test` means, in practice, that the isolation tests do not run.
 * This resolves one in order of preference:
 *
 *   1. `PROJECTS_TEST_DATABASE_URL` — a database somebody has already set up,
 *      including CI's own service container. Always wins when present.
 *   2. An embedded server, downloaded with the dev dependencies and started on
 *      a free port into a temporary directory that is deleted afterwards.
 *   3. Nothing — and the suites skip *loudly*, naming the guarantees that went
 *      unchecked, because a green run that silently skipped the client-boundary
 *      tests is worse than a red one.
 */

import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/** An unused port, asked of the operating system rather than guessed. */
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Start a database, or explain why there is none.
 *
 * Returns `{ url, stop }` on success and `{ url: null, reason }` otherwise. It
 * never throws: a missing test database is a reason to skip, not a reason to
 * fail a suite that has not run yet.
 */
export async function startTestDatabase() {
  if (process.env.PROJECTS_TEST_DATABASE_URL) {
    return {
      url: process.env.PROJECTS_TEST_DATABASE_URL,
      kind: 'external',
      stop: async () => {},
    };
  }

  let EmbeddedPostgres;
  try {
    // The package is transpiled CommonJS behind an interop default, so the
    // class sits one level deeper than the import suggests.
    const module = await import('embedded-postgres');
    EmbeddedPostgres = module.default?.default ?? module.default ?? module;
  } catch {
    return {
      url: null,
      reason:
        'no PROJECTS_TEST_DATABASE_URL and embedded-postgres is not installed — ' +
        'tenant isolation, the client boundary and audit immutability were NOT verified',
    };
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-projects-pg-'));
  const port = await freePort();

  const server = new EmbeddedPostgres({
    databaseDir: path.join(directory, 'db'),
    user: 'qodo',
    password: 'qodo',
    port,
    persistent: false,
  });

  try {
    await server.initialise();
    await server.start();
    await server.createDatabase('qodo_projects_test').catch(() => {});
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    return {
      url: null,
      reason: `embedded PostgreSQL would not start (${error.message}) — isolation and audit tests were NOT verified`,
    };
  }

  return {
    url: `postgres://qodo:qodo@127.0.0.1:${port}/qodo_projects_test`,
    kind: 'embedded',
    stop: async () => {
      await server.stop().catch(() => {});
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    },
  };
}
