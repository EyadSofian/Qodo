# Qodo Projects — Permissions

Source of truth: `shared/projects/permissions.js` (the catalogue) and
`server/projects/projectAccess.js` (the enforcement). This file explains the
model; the code is what runs.

**Status:** implemented and covered by 28 tests in
`server/projects.permissions.test.js`.

---

## 1. Two layers, both required

A Projects request is allowed only when **both** of these say yes.

| Layer | Answers | Stored in |
| --- | --- | --- |
| **Portal** — the permission set | "May this person do this *at all*, anywhere in this organization?" | `permission_sets` + `user_permission_sets` |
| **Project** — the membership | "Does that reach *this* project, and in what capacity?" | `project_members` |

Conflating them is the mistake the split exists to prevent. Holding
`task.edit` does not let you edit a task in a project you are not a member of;
being a member of a project does not let you approve timesheets if your set
never granted it.

Zoho renamed "Profiles" to **Permission Sets** in May 2025 and we follow the
current name.

---

## 2. The catalogue

79 keys, all `module.action`, in `PROJECT_PERMISSIONS`. Grouped as: projects,
phases, task lists, tasks, issues, SLA, time, timesheets, budget, rates,
billing, comments, forums, pages, documents, reports, dashboards, and
administration.

They are fine-grained on purpose. `shared/permissions.js` records what happened
last time they were not: one `tasks.edit_any` key meant "edit someone else's
task" *and* "review it", "approve it" and "score it", so there was no way to
appoint a reviewer who was not also a planner. Projects starts split —
`task.edit`, `task.edit_schedule`, `task.edit_status`, `task.assign` and
`task.delete` are five separate grants.

### Keys that belong to no built-in set except administrator

| Key | Why |
| --- | --- |
| `developer.manage` | Runs customer-authored scripts on our server. |
| `permissions.manage` | Can grant every other key, including itself. |
| `project.purge` | Destroys what the recycle bin exists to protect. |

Granted one person at a time, following the precedent `shared/permissions.js`
already sets for `management.view` and `calendar.booking`: these are not
questions about seniority, so no role can express them.

---

## 3. The built-in permission sets

| Set | For | Notable powers | Notable omissions |
| --- | --- | --- | --- |
| `admin` | Whoever runs Projects | Everything, derived from the catalogue | — |
| `manager` | Project managers | create/edit projects, assign, schedule, approve timesheets, budgets, reports | `rate.manage`, `developer.manage`, `permissions.manage`, `project.purge` |
| `employee` | Staff doing the work | own tasks, own time, internal comments, forums, pages | assign, approve, budget, **rates** |
| `contractor` | External staff | tasks and time only | internal comments, forums, reports |
| `client` | Customers | read the project, raise an issue, comment, forum | **everything else** |

`admin` is *derived* (`ALL_PROJECT_PERMISSIONS`), never typed out, so a key
added to the catalogue reaches administrators without anybody remembering to
tick a box. A test asserts this.

---

## 4. Project roles narrow; they never widen

`project_members.role` is one of `owner`, `manager`, `member`, `viewer`,
`client`. It can only take authority away.

- **`viewer` and `client`** are refused every write, whatever their set says.
- **`member`** is additionally refused `project.edit`, `project.archive`,
  `project.delete`, `project.manage_members`, `timesheet.approve`,
  `budget.manage`, `rate.*` and `baseline.*`.

This is the mirror of `visibilityCeiling` in `shared/permissions.js`: there, a
dropdown may not hand out reach the permissions do not justify; here, a
permission set may not hand out authority the project role does not justify.
Being senior elsewhere does not make you the manager of *this* project.

An unrecognised role is read as `viewer`, not as `owner`.

---

## 5. The client boundary

The single most security-sensitive rule in the module, and it has **two
independent locks**.

1. **The permission list.** A client is refused anything outside
   `CLIENT_SAFE`, which is derived from the built-in client set — so widening
   it is one decision in one place, and narrowing it cannot leave a stale
   duplicate behind that keeps granting the key.
2. **The `isClient` flag.** Set on both the membership row and the permission
   set. **If the two disagree, "client" wins**, in both directions:
   - membership says client, set says manager → client;
   - set says client, membership says manager → client.

   Because the failure mode in the other direction hands a customer an internal
   view of the company, and a mistyped role in an admin form must not be able
   to do that.

The API takes the *role* and derives the flag; it never accepts `isClient` from
the request body. A caller who could send `{role: 'manager', isClient: false}`
for a customer would have found the way past this.

`visibleProjectIds` has a separate branch for clients with no portal-access
fallback and no administrator fallback — one branch, so it cannot be
half-applied.

Internal/external flags on phases, task lists, folders and comments are the
third layer, filtered **in SQL** on every listing, not in the component.

### What a client may never hold

Asserted by name in the test suite, so widening the set trips a test rather
than shipping: `comment.internal`, `time.*`, `budget.*`, `rate.*`, `reports.*`,
`audit.view`, `customization.manage`, `automation.manage`,
`project.manage_members`, `task.create`, `task.edit`.

---

## 6. Deny by default

`canInProject` has no `else`. Every path that is not an explicit yes returns
`false`:

- no membership → `false` for **every** key, including `project.view`;
- an unknown permission string → `false`;
- an empty or missing context → `false`, not a crash.

A test iterates the entire catalogue against a non-member and asserts all 79
are refused.

---

## 7. Not found, not forbidden

`contextFor` returns `null` for four different situations, and the route turns
all four into **404**:

1. the project does not exist;
2. it belongs to another organization;
3. it is deleted;
4. this person is not a member.

Answering `403` for the last case would confirm to a stranger that a project
with that id exists, which is itself information about the company. Collapsing
the four in one place, rather than at each call site, is what stops one route
from being more talkative than the others.

---

## 8. Field-level permissions

`projectFields()` strips sensitive columns on the way out. Today that is the
rate fields, gated on `rate.view`.

The audit log carries its own redaction list (`REDACTED` in `auditService.js`),
and a test cross-checks the two: **a field stripped from a record must also be
redacted in its history**, because the audit log is read by more people than the
record it describes. That test has already caught one real leak — `hourlyRate`
was stripped from records and would have been written into the audit log
verbatim.

---

## 9. Implicit membership

Two ways to reach a project you were never added to, both deliberate and both
narrow:

| Case | Granted role | Applies to clients? |
| --- | --- | --- |
| Project `access = 'portal'` — the organization opened it to its own staff | `viewer` | **No** |
| Workspace administrator | `manager` | **No** |

The administrator case exists because locking an administrator out of a project
they are responsible for just means they add themselves as a member first —
same result, worse audit trail. The membership is marked `implicit` so the UI
can say why access exists.

---

## 10. What the browser knows

`GET /api/projects/me` returns the caller's permission keys, and
`useProjectPermissions` caches them. **This is presentation only.** Every route
re-checks with `permit()` (in-project) or `permitPortal()` (organization-level).

A UI that offers a button the server will refuse is worse than one that hides
it — but hiding it is not enforcement, and nothing in this module treats it as
such.
