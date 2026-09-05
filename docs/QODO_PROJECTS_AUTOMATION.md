# Qodo Projects — Automation

> **Status: design, not implementation.** Nothing in this document is built.
> The schema it describes is specified in `QODO_PROJECTS_DATABASE.md` §4.7 and
> is scheduled for Phase 8. This file exists so the design is settled before the
> code, and so the parity matrix has something concrete to check rows against.
> Treat every "does" below as "will do".

Reference: Zoho Projects Settings → Automation (7 sections, 33 articles) and
Developer Space (3 sections, 24 articles), audited 2026-09-05.

---

## 1. What the audit found

Zoho's automation surface is now per-module and wider than the brief described:

| Module | Automation available |
| --- | --- |
| Projects | workflow rules, email alerts, webhooks, custom functions |
| Tasks | the above, plus Blueprint |
| Phases | full rule surface (8 articles, added 2026) |
| Issues | the above, plus **business rules** and **SLA** |
| Timesheets | workflow rules |
| Time logs | workflow, **time-based** rules, custom functions, webhooks, email, **WhatsApp** (2026) |
| Users | workflow rules (added Nov 2025) |

Plus **Macro rules** (a manually-invoked batch of actions) and **Automation
credits** (metered execution).

Two things changed since the brief was written and the design follows the
product, not the brief:

1. **Custom Functions are now CodeX Scripts** — JavaScript, a published JS SDK,
   and a credit model. The brief's instinct against arbitrary server-side
   execution is right and is where Zoho landed too.
2. **WhatsApp is an automation action**, using approved message templates.

---

## 2. One engine, parameterised by module

Seven modules with the same trigger/criteria/action shape is one engine, not
seven. `automationService` takes the module as data; `workflow_rules.module_id`
is a foreign key, not a `switch`.

```
event  →  match rules for (module, trigger)
       →  evaluate criteria against the record
       →  run actions in order
       →  record the run (idempotency key, status, error)
```

### Triggers

`create`, `update`, `field_change`, `status_change`, `assignment`,
`completion`, `delete`, plus **time-based**: an offset from any date field
(`3 working days before due_date`) evaluated by the existing
`server/scheduler.js`.

### Criteria

The same closed vocabulary as custom views and layout rules —
`{match: 'all'|'any', conditions: [{field, operator, value}]}`. One evaluator,
one set of operators, one place to fix a bug. **Nothing stored is executable.**

### Actions

| Action | Notes |
| --- | --- |
| `update_field` | Re-validated against layout rules and field permissions |
| `assign` | To a user, a project role, or the project owner |
| `add_tag` / `remove_tag` | |
| `notify` | Through the existing Qodo notification centre |
| `email` | Templated, via the existing nodemailer path |
| `whatsapp` | Adapter; **inert without credentials** (ADR-11) |
| `create_task` / `create_subtask` / `create_issue` | |
| `webhook` | HMAC-signed, retried, logged |
| `run_script` | A CodeX script (§6) |
| `request_approval` | |

---

## 3. Blueprint — the state machine

Administrators design which transitions exist, who may make them, and what must
be true first.

A transition carries: source status, destination status, name, permitted roles,
required fields, whether a comment is mandatory, validations, before-actions and
after-actions.

**Three rules that are not negotiable.**

1. **The API cannot bypass it.** A status change through `PATCH /tasks/:id` runs
   the same transition check as the Kanban drag. A drag is a request, not a
   permission. This is the difference between a Blueprint and a UI convention,
   and there is a test for it in the definition of done.
2. **Versions are immutable.** `blueprint_versions` is insert-only, and
   `record_blueprint_versions` pins each record to the version it was created
   under. Publishing a new blueprint cannot retroactively invalidate history
   (§25).
3. **Migration is explicit.** Moving existing records onto a new version is an
   action somebody takes, never a side effect of publishing.

---

## 4. Business rules — ordered, with stop-processing

Distinct from workflow rules, and Zoho keeps them distinct for a reason:
business rules are an **ordered list** evaluated top to bottom on save,
primarily for issues, and any rule may stop the ones below it.

Administrators reorder them. `business_rules.order_index` and
`stop_processing` are the whole model; the subtlety is entirely in evaluation
order, which is why the test for it asserts ordering and stopping rather than
individual actions.

---

## 5. Webhooks

`webhook_endpoints`: URL, method, headers, events, timeout, retry ceiling, and
`secret_encrypted`.

- Every delivery is **HMAC-signed** with the endpoint secret.
- **The secret is never returned by any read endpoint** — the API answers with a
  masked constant. There is no "reveal" route.
- `webhook_deliveries` records payload, response status, attempt number and
  error, so a failing integration is diagnosable without server access.
- Retries are bounded and backed off. A permanently failing endpoint is disabled
  and its owner notified, rather than retried forever.

---

## 6. CodeX Scripts — the sandbox

The extension point, and the one place where getting it wrong is a server
compromise rather than a bug.

**Not** `eval`. **Not** `vm` with host globals. **Not** arbitrary `require`.

| Control | Rule |
| --- | --- |
| Isolation | A worker with no filesystem, no network, no process access |
| Timeout | Hard, enforced by terminating the worker, not by cooperation |
| Memory | Capped |
| Surface | An allowlisted SDK — read the record, update permitted fields, call a configured connector. Nothing else exists |
| Authority | Runs **as the triggering user**; it cannot do what that user cannot |
| Versioning | Scripts are versioned; a running automation pins its version |
| Quota | Metered per organization — a runaway loop must cost something finite |
| Audit | Every run recorded: script, version, entity, duration, outcome |
| Permission | `developer.manage`, which **no built-in permission set carries** |

Ships last (Phase 8), deliberately.

---

## 7. Idempotency

Automation runs at least once, so it must be safe to run twice.

- Every run computes an idempotency key from `(rule_id, entity_id, trigger,
  event_timestamp)` and `automation_runs.idempotency_key` is `UNIQUE`. A retry
  after a crash inserts nothing and does nothing.
- The scheduler uses deterministic ids for generated records, the way
  `createIfAbsent` in `server/store.js` already does for HR's recurring tasks —
  the existing pattern, not a new one.
- Actions that create records check for their own prior output before creating.

**Loop protection.** An automation whose action re-triggers its own rule is the
classic failure. Runs carry a depth counter, and a chain past a fixed depth is
stopped and recorded as an error rather than left to run.

---

## 8. Test mode

A rule can be evaluated against a chosen record without executing its actions,
returning what *would* happen. Administrators write rules against production
data and the alternative to a dry run is finding out on live records.

---

## 9. Definition of done for this phase

- Ordered business rules, with stop-processing, proven by test.
- A Blueprint transition that the raw API cannot bypass, proven by an explicit
  bypass-attempt test.
- Idempotency proven by running the same trigger twice and asserting one effect.
- Webhook secrets proven absent from every read response.
- A script that tries to read the filesystem, open a socket, or outlive its
  timeout, proven to fail.
- Every automation action recorded in the audit log with `source = 'automation'`
  — an automation that cannot say "this was me, not the manager" makes the audit
  trail useless.
