# Roles and Permissions

## The rule everything else follows

A task is a contract between two people: one side commissions the work, the
other side does it. **Nobody may play both parts.** Creating, assigning,
planning, reviewing, approving, scoring and archiving are all the commissioning
side, and none of them reach the `member` role. Doing the work is two actions —
pick it up, hand it in — and both are recorded.

## Current model

| Role | Task visibility | Task actions | Performance | Export |
| --- | --- | --- | --- | --- |
| Administrator | All departments in own organization | Everything, plus the permanent purge | All organization | Yes |
| Manager | Own department | Create, assign, plan, review, approve, score, archive | Own department | Yes |
| Member | Own sub-team board | Respond to an assignment; start; submit | Self only | No |
| Viewer | Own sub-team board | Read only | Self only when applicable | No |

An optional per-user permission array replaces role defaults. Every backend
route re-checks the effective permission and resource scope.

## The task permission keys

| Key | What it authorises |
| --- | --- |
| `tasks.create` | File a task at all |
| `tasks.assign` | The brief and the plan: assignee, team, due date, what is asked for |
| `tasks.edit_any` | Edit the *contents* of a colleague's task — progress, notes, labels |
| `tasks.review` | Read submitted work and send it back |
| `tasks.approve` | Close a task, and reopen a closed one |
| `tasks.score` | Put a number on someone's record, and read the team's scores |
| `tasks.archive` | Take a task off the board, and restore it |
| `tasks.delete_any` | Permanently destroy an archived task, its comments and its files |

These used to be one key. `tasks.edit_any` alone meant "edit a colleague's card"
*and* review, approve, score and re-plan it, so there was no way to appoint a
reviewer who is not also a planner. Splitting them is what makes the table above
expressible.

**Overrides saved before the split** carry `tasks.edit_any` and none of the four
new keys; `permissionsFor` reads that combination as still meaning all four, and
`tasks.delete_any` as also meaning `tasks.archive`. The back-fill stops applying
to a user the moment an administrator saves them again with explicit keys.

## Why the due date sits on the commissioning side

`performanceSummary` measures `onTimeRate` and `overdue` against `dueDate`.
Anyone who can set their own due date is writing the metric they are judged by,
which is why it is in `PLAN_FIELDS` and not editable by the assignee. An
assignee proposes a new date through the assignment response; a manager grants it.

## Archiving, not deleting

Clearing a task away is `POST /tasks/:id/archive` — the card leaves every board,
count, export and search, and the record stays fetchable by id. Restoring is the
same authority undone.

The permanent purge (`DELETE /tasks/:id`) destroys the comments and the uploaded
deliverables with the task. It is administrator-only and refuses anything that is
not already archived, so removing a task is always two deliberate steps by two
different kinds of authority.

## Account status

`active`, `pending` or `disabled`. Only `active` resolves to a session — the
check runs on every request, not just at login, so disabling or un-approving an
account ends the session it already holds. `pending` is an account created
through an invite link and not yet approved; it fails `can()` for every
permission and returns `account_pending` on login.

## Visibility scope

Separate from permissions and evaluated after them. `visibilityScope` on a user
is one of `own`, `subteam`, `department`, `all`, or null to follow the role.
Following the role means the sub-team for an employee and the department for a
manager. It narrows only: `visibilityFor` caps it at the ceiling the permissions
justify, so the dropdown can never hand out reach the keys do not.

A sub-team default only means something to somebody who is in one — departments
that declare no sub-teams fall through to the department. See
`docs/organization-structure.md`.

## Resource policy order

1. authenticated active user;
2. matching `organizationId`;
3. permission key;
4. visibility scope (own / sub-team / department / organization);
5. relationship to the specific task;
6. action-specific workflow rule.

## Still open

Project roles and per-task responsibilities are not yet evaluated in addition to
the organization role.
