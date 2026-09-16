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

## The course workspace

A course opens on a header — cover, name, lesson count, completion, target date,
production manager — and six tabs, plus Files and Settings where the reader has
the rights for them.

| Tab | What it answers |
| --- | --- |
| Overview | Where the course stands: four figures, the five stages, what is in production right now, and what needs somebody today. |
| Content | The structure: modules, and each lesson as one row with its five stages side by side. The editing tools (reorder, rename, duplicate, move, archive) appear on hover and on keyboard focus. |
| Production | The matrix — every lesson down, the five stages across, filters and bulk assignment. |
| Assets | One lesson's five deliverables, each drawn as the thing it is: the outline's objectives, a slide, the narration, a waveform, a video frame. Opening a card opens that asset's real review workspace. |
| Team | Who is on the course, in which production roles, how loaded they are, and who makes and reviews each stage by default. |
| Activity | The history, in sentences. |

The Assets board is fed by `GET /lessons/:lessonId/asset-board`, which returns
the five asset summaries plus a small preview of each current version — a couple
of outline sections, the first lines of narration, the audio duration. It never
returns the content itself; reading it is what opening the asset is for.

## Demo data

`npm run seed:learning-demo` fills a development database with seven courses,
about a hundred lessons and five hundred assets — versions, review decisions,
comments, annotations, timestamped audio and video notes, QA checklists and a
back-dated activity history. It exists because none of the screens above can be
judged against three lessons typed in by hand.

```sh
npm run seed:learning-demo             # build it
npm run seed:learning-demo -- --reset  # remove it and build it again
npm run seed:learning-demo -- --remove
npm run seed:learning-demo -- --for=someone@example.com   # whose My Work it fills
```

The loader lives in `scripts/`, not in `server/`: nothing the application runs
can reach it. It refuses outright when `NODE_ENV=production`, marks every course
it writes with `is_demo` and every account with `isDemo`, and removes exactly
what those two facts point at. The demo staff are real user rows — the assignee
picker and the workload report would accept nothing less — created with no
password hash and addresses on the reserved `.invalid` domain, so neither the
password route nor the Google route can turn one into a session.

Two things about the content are deliberate. Course health is spread across all
four states (one completed, three on track, two at risk, one delayed) by giving
each course a share of late work either side of the `delayedOverdueShare`
threshold rather than by chance. And the finished videos are links rather than
files: a PDF deck and a WAV recording can be generated from arithmetic, so the
slide reviewer and the audio reviewer work on real bytes, but an MP4 cannot, and
a file that fails to play would prove less than an honest link.

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
