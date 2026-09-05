# Qodo Projects — Testing

**Current state:** 61 Projects tests, all passing. The full workspace suite is
205 passing, 0 failing. 6 database-backed suites **skip** on machines without
PostgreSQL, and say so.

```bash
npm test                                   # everything
node --test server/projects.permissions.test.js
node --test server/projects.scheduling.test.js
```

---

## 1. Three tiers, and why

| Tier | Runs | Needs | Files |
| --- | --- | --- | --- |
| **Pure** | Everywhere, every time | nothing | `projects.permissions.test.js`, `projects.scheduling.test.js` |
| **Database** | When a test database is configured | PostgreSQL | `projects.integration.test.js` |
| **Browser** | Phase 12 | Playwright + PostgreSQL | not yet written |

The split is deliberate. The rules that decide *who sees what* and *when work
happens* are pure functions, so they are tested where they can run in every CI
job rather than only where a database happens to be installed. What is left for
the database tier is the part that genuinely is database behaviour — tenant
isolation, membership, and the trigger that refuses to let history be rewritten.

---

## 2. Skipping is loud

Without `PROJECTS_TEST_DATABASE_URL` every database test skips with this
reason attached to each suite:

> no PROJECTS_TEST_DATABASE_URL — tenant isolation and audit immutability were
> NOT verified

A suite that silently passes when the isolation tests did not run is worse than
one that fails, because it reports a safety property nobody checked. `node
--test` lists skipped suites individually, so the reader sees exactly which
guarantees went unverified.

To run them:

```bash
docker run -d -e POSTGRES_PASSWORD=qodo -p 5432:5432 postgres:16
```

```bash
PROJECTS_TEST_DATABASE_URL=postgres://postgres:qodo@localhost:5432/postgres node --test server/projects.integration.test.js
```

The suite drops and recreates the schema on each run, rather than truncating, so
the **migration runner is itself exercised** — a migration added since the last
run gets applied for real.

> **Known gap, stated plainly.** The workstation this module was built on has
> neither PostgreSQL nor Docker. The two migrations and every database-backed
> path have therefore been written and syntax-checked but **never executed**.
> That is the single largest untested surface in the module and the first thing
> to run on a machine that has a database.

---

## 3. What the pure tests cover

### Authorization — 28 tests

- Catalogue integrity: keys unique, namespaced, and every key in every set
  exists.
- `admin` tracks the catalogue automatically.
- Three keys belong to no set but `admin`.
- **Deny by default**: all 79 permissions refused to a non-member; unknown
  permissions refused; an empty context refused rather than crashing.
- **The client boundary**, from both directions: a client permission set with a
  staff project role, and a client project role with a staff permission set.
  Both resolve to client.
- A named list of keys a client must *never* hold — so widening the client set
  trips a test instead of shipping.
- Roles narrow: a viewer with the administrator set still cannot write; a
  `member` with the manager set still cannot approve or see a rate.
- An explicit permission array replaces the built-in template.
- Audit `diff` reports only real changes, treats added fields as changes from
  null, and redacts rates and secrets.
- **A cross-check** that every rate field stripped from a record is also
  redacted in its history.
- Project key derivation, including punctuation, Arabic, and empty input.

### Scheduling — 33 tests

- Engosoft's working week is Sunday–Thursday, and a Western default would be
  silently wrong.
- Holidays, and a calendar with no working days falling back instead of hanging.
- Working-day arithmetic forwards and backwards over the weekend.
- The inclusive-span convention (Sunday to Sunday is one day).
- All four dependency types — FS, SS, FF, SF — with lag in working days.
- Cycle detection returning the **path**, not a boolean; diamonds are not
  cycles; a 2000-node chain does not overflow the stack.
- Critical path and float on a real diamond network, with the short branch
  carrying exactly four days of float.
- A holiday inside a task pushing the whole chain.
- Baseline variance signs: late is positive, early is negative, on-plan is zero,
  and a task added after the baseline reports `null` rather than a fabricated
  zero.
- Cascade reporting **only** what moved, plus the project slip in working days.

Expected dates are written out by hand against a real calendar, never taken from
the code's own output. That is what makes them a check rather than a snapshot.

---

## 4. Two real bugs these tests caught

Recorded because they are the argument for the tests existing.

1. **`hourlyRate` leaked into the audit log.** It was stripped from records by
   `projectFields()` but absent from the audit redaction list, so a rate hidden
   on the task page would have reappeared in that page's history. Found by the
   cross-check test, not by review.
2. **Punctuation was deleted instead of splitting words.** `deriveKey` turned
   "Al-Rehab / Phase 2" into `AP2`, silently dropping "Rehab" — a project key
   that is wrong forever, because keys are immutable.

---

## 5. What the database tests will cover

Written and ready; unexecuted here.

| Group | Asserts |
| --- | --- |
| Migrations | every file applied, checksums recorded, a second run is a no-op |
| Lifecycle | owner becomes a member; keys unique per organization; inverted dates refused; archive/unarchive move between scopes; delete is reversible and purge is not |
| **Tenant isolation** | another organization's **administrator** cannot resolve, list, restore or purge a project; a non-member in the same organization cannot resolve a private one; adding membership is what grants access; the owner cannot be removed |
| **Client boundary** | a client member is flagged on the way in; `isClient: false` in the request body does not smuggle a client in as staff; a client sees only projects they were added to and **never** portal ones |
| **Audit** | create and update both leave a record; `UPDATE` and `DELETE` on `audit_events` are refused **by the database**; a purge is recorded *before* the rows go |
| Pagination | a page is bounded however large a limit is asked for; the total is the whole set |

---

## 6. Definition of done

A parity-matrix row reaches **Verified** only with an automated test that would
fail if the feature regressed. Not "a test exists" — a test that *catches the
regression*.

Required for every new feature:

- server-side authorization, including a **negative** test from the wrong
  organization and from a non-member;
- persistence that survives a reload;
- Arabic and English, RTL and LTR;
- realistic loading, error and empty states;
- for anything a client user can reach, an explicit leakage test.

---

## 7. Not yet written

| Gap | Phase |
| --- | --- |
| Playwright E2E — the 20 flows in the brief §77 | 12 |
| Frontend component tests | 2+ |
| Budget and EVM arithmetic | 5 |
| Timer concurrency against the `UNIQUE … WHERE stopped_at IS NULL` constraint | 5 |
| Recurrence determinism and retry-without-duplicates | 3 |
| SLA breach and escalation timing | 4 |
| Blueprint bypass attempts through the raw API | 8 |
| Automation idempotency and retry | 8 |
| CSV formula-injection on export | 11 |
