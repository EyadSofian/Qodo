# Task Management Architecture

Last reviewed: 2026-07-30

## Runtime

- Frontend: React 18, TypeScript, Vite, Tailwind CSS, React Router.
- Backend: Express 4 on Node.js 20+.
- Storage: one repository abstraction with:
  - a local JSON document file plus file blobs for development; or
  - PostgreSQL `documents` JSONB rows plus `blobs` bytea rows.
- Authentication: signed HttpOnly session cookie; bcrypt password hashes.
- Authorization: shared permission names plus server-owned resource policies.
- Localization: Arabic/English strings with RTL/LTR document direction.

## Current task request flow

```text
React task view
  → /api/tasks
  → attachUser(session cookie)
  → taskAccess organization/department/resource policy
  → task route validation and workflow guard
  → document/blob store
  → activity + notification side effects
  → user-specific score masking
  → React response
```

The browser hides actions for usability, but it is not the enforcement point.
Every protected operation is checked again on the server.

## Core stored documents

### Organization

The default organization is `engosoft`. It carries name, slug, timezone,
currency, language and working-hours defaults. Organization administration is
not implemented yet.

### User

Important independent fields:

- `organizationId`
- access `role` and optional permission override
- primary `department`
- optional `subteam`
- optional `jobRole`

The access role is intentionally not the employee's job title.

### Task

Key groups:

- Identity: `id`, readable `reference`, `organizationId`.
- Brief: title, description, objective, definition of done, notes.
- Organization: department and optional subteam.
- Planning: priority, effort points, estimated minutes, task date, due date.
- Execution: assignee, assignment status, progress, started/submitted timestamps.
- Review: review decision/note, return count, reviewer and timestamps.
- Performance: score, scorer and timestamp.
- Evidence: denormalized attachment count; attachment documents and blobs live
  separately.

### Assignment event

Every assignment and assignee response creates a `taskAssignments` document.
It records organization, task, actor, assignee, action, status, metadata and
timestamp. This history is not reconstructed from the latest task state.

## Authorization scopes

```text
Organization boundary (always)
  └── administrator: all departments in the organization
      manager: own department
      member/viewer: own department board
```

Score visibility is narrower than task visibility:

- assignee: own score and review note;
- manager: department scores;
- administrator: organization scores;
- coworker: task data with score/review verdict masked.

## Known architectural limits

- The document store cannot enforce foreign keys or multi-document transactions.
- Most queries load a collection then filter in JavaScript.
- Task workflows and organization classifications are code-defined.
- A second tenant must not be enabled until all non-task modules and scheduled
  jobs have equivalent tenant tests.
- The activity collection is an operational history, not yet an immutable
  compliance ledger.

The phased replacement path is to keep the route/service contracts and move
security-critical entities to normalized, indexed tables behind the same
repository boundary.
