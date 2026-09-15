# E-Learning Production

The E-Learning Production module manages educational content from outline to
final video:

`Course → Module → Lesson → Outline → PPT → Script → Voice Over → Video`

It is a separate domain from Qodo Projects and Tasks. It shares workspace
authentication, organization identity, people, notifications, and the blob
storage abstraction, but owns its own PostgreSQL schema, services, permissions,
API routes, and UI.

## Routes

- `/learning-production` — dashboard
- `/learning-production/courses` — course list
- `/learning-production/courses/:courseId` — course workspace
- `/learning-production/courses/:courseId/lessons/:lessonId/:stage` — asset workspace
- `/learning-production/my-work` — assigned work
- `/learning-production/reviews` — review queue
- `/learning-production/reports` — production reports

## Data and workflow

The schema lives under `server/learningProduction/migrations/`. A lesson gets
exactly five assets. Versions, approvals, comments, annotations, audio/video
markers, checklists, team assignments, and activity are persisted and retain
their history. Status transitions and dependencies are enforced by
`shared/learningProduction/workflow.js` and repeated by database constraints
where history must not be rewritten.

The main course view is the production matrix. Each cell links to the exact
asset workspace. Text assets autosave drafts and snapshot immutable versions
when submitted; file assets stream versioned uploads and support slide, audio,
and video review contexts.

## Local configuration

The module uses `DATABASE_URL`. Without a database the rest of the workspace
still starts and the module shows a clear unavailable state. Optional limits
and media settings are documented in `.env.example`. Set
`LEARNING_PRODUCTION_DEMO=enabled` only when demo data should be available
outside development.

## Verification

Run the normal checks from the repository root:

```sh
npm run typecheck
npm run build
npm test
```

The learning-production test suites cover workflow rules, permissions, tenant
boundaries, migrations, HTTP error contracts, uploads and byte ranges, and the
complete PPT, voice, and video review flows.
