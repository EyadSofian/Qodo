# Roles and Permissions

## Current model

| Role | Task visibility | Task actions | Performance | Export |
| --- | --- | --- | --- | --- |
| Administrator | All departments in own organization | Create/edit/delete/review | All organization | Yes |
| Manager | Own department | Create/edit/delete/review | Own department | Yes |
| Member | Own department board | Create; edit own/assigned; assignment and delivery actions | Self only | No |
| Viewer | Own department board | Read only | Self only when applicable | No |

An optional per-user permission array replaces role defaults. Every backend
route re-checks the effective permission and resource scope.

## Account status

`active`, `pending` or `disabled`. Only `active` resolves to a session — the
check runs on every request, not just at login, so disabling or un-approving an
account ends the session it already holds. `pending` is an account created
through an invite link and not yet approved; it fails `can()` for every
permission and returns `account_pending` on login.

## Visibility scope

Separate from permissions and evaluated after them. `visibilityScope` on a user
is one of `own`, `subteam`, `department`, `all`, or null to follow the role. It
narrows only: `visibilityFor` caps it at the ceiling the permissions justify.
See `docs/organization-structure.md`.

## Resource policy order

1. authenticated active user;
2. matching `organizationId`;
3. permission key;
4. visibility scope (own / sub-team / department / organization);
5. relationship to the specific task;
6. action-specific workflow rule.

## Required next split

The existing `tasks.edit_any` key currently implies manager review/scoring.
The enterprise model should split at least:

- `task.assign`
- `task.review`
- `task.approve`
- `score.manage`
- `task.archive`
- `task.restore`

Project roles and task responsibilities must then be evaluated in addition to,
not instead of, the organization role.
