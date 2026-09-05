# Qodo Projects — Testing

**Current state:** 407 tests passing, 0 failing — 263 of them Projects tests,
and **164 of those run against a real PostgreSQL on any machine**, because the
harness starts an embedded one when no test database is configured.

```bash
npm test                                   # everything
node --test server/projects.permissions.test.js
node --test server/projects.scheduling.test.js
```

---

## 1. Three tiers, and why

| Tier | Runs | Needs | Files |
| --- | --- | --- | --- |
| **Pure** | Everywhere, every time | nothing | `projects.permissions.test.js`, `projects.scheduling.test.js`, `projects.automation.test.js`, `projects.data.test.js` |
| **Database** | Everywhere — an embedded PostgreSQL starts if none is configured | the `embedded-postgres` dev dependency, or a `PROJECTS_TEST_DATABASE_URL` | `projects.integration.test.js` |
| **Browser** | By hand, this pass | a live database | see §6 |

The split is deliberate. The rules that decide *who sees what* and *when work
happens* are pure functions, so they are tested where they can run in every CI
job rather than only where a database happens to be installed. What is left for
the database tier is the part that genuinely is database behaviour — tenant
isolation, membership, and the trigger that refuses to let history be rewritten.

---

## 2. The database tier runs everywhere

`server/projects/testDatabase.js` resolves a PostgreSQL in this order:

1. **`PROJECTS_TEST_DATABASE_URL`** — a database somebody set up, including a
   CI service container. Always wins.
2. **An embedded server**, downloaded with the dev dependencies and started on a
   free port into a temporary directory that is deleted afterwards.
3. **Nothing** — and every suite skips *loudly*, naming the guarantees that went
   unchecked.

The third case exists because a green run that silently skipped the
client-boundary tests is worse than a red one. It should never be reached on a
machine that ran `npm install`.

The security properties this module rests on — tenant isolation, the client
boundary, an audit log the database itself refuses to rewrite, a unique index
that stops two timers running — are **PostgreSQL behaviour**. An in-memory
emulator would happily let you update a row the real trigger refuses and report
a pass, which is why the harness insists on a real server.

The suite drops and recreates the schema on each run rather than truncating, so
the **migration runner is itself exercised**: all nine migrations are applied for
real on every run.

```bash
npm test
```

```bash
PROJECTS_TEST_DATABASE_URL=postgres://postgres:qodo@localhost:5432/postgres npm test
```

---

## 3. What the pure tests cover — 99 tests

**Authorization (28).** Catalogue integrity; `admin` tracking the catalogue
automatically; three keys belonging to no set but `admin`; **deny by default**
across all 79 permissions for a non-member; **the client boundary from both
directions** — a client set with a staff role and a client role with a staff
set, both resolving to client; a named list of keys a client must never hold;
roles narrowing but never widening; audit `diff` redaction; a cross-check that
every rate field stripped from a record is also redacted in its history; project
key derivation.

**Scheduling (33).** Engosoft's Sunday–Thursday week as the default; holidays; a
calendar with no working days falling back rather than hanging; working-day
arithmetic in both directions across the weekend; the inclusive-span convention;
all four dependency types with lag; cycle detection returning the **path**; a
2000-node chain not overflowing the stack; critical path and float on a diamond
network; baseline variance signs, with a task added after the baseline reporting
`null` rather than a fabricated zero; cascade reporting only what moved.

**Criteria and automation (20).** An unknown operator matching **nothing**;
absent values not reading as zero; the change operators needing a previous
state; every operator the validator accepts being one the evaluator handles; the
action vocabulary containing nothing that executes; idempotency keys stable for
a retry and different for a new change; **webhook SSRF** — loopback, link-local
and private ranges all refused, including `169.254.169.254`; signatures covering
the timestamp so a delivery cannot be replayed.

**Import, export and credentials (19).** Every cell a spreadsheet would execute
neutralised; the BOM that makes Excel read Arabic correctly; quoted CSV fields
with commas, newlines and doubled quotes; rate columns dropped without
`rate.view`; a mapping to a field that does not exist refused; validation
reporting the row number as it appears in the file; credentials not surviving
encryption in readable form and a tampered one failing to decrypt.

Expected dates and values are written out by hand, never taken from the code's
own output. That is what makes them a check rather than a snapshot.

---

## 4. What the database tests cover — 164 tests

| Group | Asserts |
| --- | --- |
| Migrations | all nine applied, checksums recorded, a second run is a no-op, **every table carries an organization boundary** |
| Lifecycle | owner becomes a member; keys unique per organization; inverted dates refused; archive/unarchive; delete reversible and purge not |
| **Tenant isolation** | another organization's **administrator** cannot resolve, list, restore or purge a project; a non-member cannot resolve a private one; membership is what grants access; the owner cannot be removed |
| **Client boundary** | a client cannot be smuggled in as staff; a client sees only projects they were added to and **never portal ones**; internal phases, task lists, tasks, issues, comments and documents are invisible by listing *and* by id |
| Work breakdown | phase ordering; a list in an internal phase cannot be made client-visible; a task existing in both halves; subtask depth; cycle prevention; deleting a subtree |
| Checklists | a required item **blocks completion**; ticking it unblocks; an optional one never blocks |
| Scheduling | dependencies refused across projects; a loop refused before it is stored; successors landing on working days; preview writing nothing and commit writing the cascade; baseline immutability; variance |
| Metadata | defaults seeded once; statuses scoped per organization; **retiring a status not breaking the records pointing at it**; field types closed; server-side field validation |
| Issues & SLA | per-project reference numbering; links confined to the project; closing derived from the status category; a clock starting only when a policy matches; working minutes skipping the weekend; a breach recorded once; pausing pushing the deadline out |
| Time & money | **the one-running-timer rule enforced by the database, not the service**; hours validated; logging somebody else's time needing its own permission; a task's hours following from its entries; an empty week not submittable; nobody approving their own; a rejection needing a reason; **approval freezing the rates so a later raise cannot rewrite history**; budget states at their thresholds; a project with nothing measured reporting null; earned value refusing when its inputs are missing |
| Collaboration | comments internal by default; a client's own comment always visible to them; mentions read from the body rather than trusted from the caller; visibility not editable after posting; page revisions kept and restore not truncating history |
| Documents | filename traversal neutralised; the media allowlist refusing what a browser would execute; download tokens bound to one person; versions; a client refused by listing and by id |
| **Automation** | unknown actions and broken criteria refused at save; a rule firing once and a retry doing nothing; a different change still firing; project scoping; **the depth limit stopping a loop and recording it**; dry runs writing nothing; quota exhaustion |
| **Blueprint** | defined transitions allowed and undefined ones refused with the alternatives named; required fields and comments enforced; roles enforced; published versions immutable **by trigger**; **a record keeping the version it was attached to when a stricter one is published**; migration being a deliberate action |
| Reports | groupings and measures refused unless allowlisted — `"title; DROP TABLE projects"` is refused, not escaped; **scoping by membership before filtering**; money measures needing `rate.view`; saved reports storing definitions rather than rows |
| Portfolio | only visible projects; delayed and at-risk meaning different things; nulls rather than zeroes; **workload measured in hours, not task count** |
| Dashboards | widget types closed; somebody else cannot edit your dashboard; one broken widget not taking the board down |
| AI | **a client cannot get a summary of a task they cannot see**; duplicate detection scoped to the project; an empty portfolio answered honestly rather than invented |
| Audit | create and update recorded; `UPDATE` and `DELETE` refused **by the database**; a purge recorded before the rows go; rates never written into the log |

---

## 5. Bugs these tests found

Ten, listed in `QODO_PROJECTS_PARITY_MATRIX.md` §6. Four of them were security
or data-integrity defects that review had not caught: a client-visibility leak,
a date shifted a day earlier for every user east of Greenwich, a rate that would
have reappeared in an audit log, and a completion guard that never fired because
one field name meant two shapes.

---

## 6. Browser verification

Done by hand this pass, against a live PostgreSQL, in Arabic RTL:

- all nine migrations applied on boot, in order, logged;
- a project created and persisted **across a server restart**;
- the project key auto-derived through the punctuation fix;
- a phase created with its client visibility stated in full on the form;
- a task created carrying a real workspace task reference — the ADR-3 join
  end to end;
- the Gantt computing and marking the critical path, with an LTR time axis
  inside an RTL page;
- the budget reporting "لم يُقَس" (not measured) rather than zero;
- earned value refusing with its missing inputs named;
- every external adapter reporting `not_configured` with the reason;
- the mobile viewport stacking without horizontal page scroll;
- no console errors and no failed requests.

Two bugs were found this way and fixed: the member list returning raw
snake_case rows, and a member rendering as a UUID instead of a name.

---

## 7. Definition of done

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

## 8. Not yet written

| Gap | Notes |
| --- | --- |
| Playwright E2E — the 20 flows in §77 | The flows are covered at the service level; what is missing is the browser automation that walks them. Browser verification was done by hand this pass (§6). |
| Frontend component tests | No component test harness exists in the repository yet; adding one is a workspace-wide decision rather than a Projects one. |
| Recurrence determinism | The table exists; the generator is not written. |
| CodeX sandbox escape tests | The sandbox is not built (see the matrix, §7). |
| CSV formula injection at the HTTP boundary | The guard is tested as a pure function; an end-to-end download assertion would need the E2E harness. |
