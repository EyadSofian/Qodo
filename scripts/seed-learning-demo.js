/**
 * Load (or remove) the E-Learning Production demo data.
 *
 *   npm run seed:learning-demo            # build it
 *   npm run seed:learning-demo -- --reset # remove it and build it again
 *   npm run seed:learning-demo -- --remove
 *
 * Why this exists: every screen in the module — the matrix, the review queue,
 * the reports, the stage progress — is a picture of a busy production studio,
 * and none of it can be judged against three lessons typed in by hand. This
 * writes about a hundred lessons across seven courses, with versions, review
 * decisions, comments, annotations, timestamped audio and video notes, QA
 * checklists and a back-dated activity history.
 *
 * Four promises it keeps, in the order they matter:
 *
 * **It never runs by itself.** Nothing in `server/` imports this file. It is not
 * called from `seed.js`, from the scheduler, or from any code a deploy reaches.
 * The only way a row from here exists is that somebody ran the command.
 *
 * **It refuses to run against production.** `NODE_ENV=production` is a hard
 * stop with no override flag, because the one thing worse than a demo nobody
 * loaded is a demo somebody loaded into a customer's database.
 *
 * **Everything it writes is marked.** Courses carry `is_demo`, users carry
 * `isDemo`, and removal walks from those two facts. It does not delete by name,
 * so a company that liked "CMRP Certification" enough to build a real course
 * under that name keeps it.
 *
 * **The demo staff cannot sign in.** They are real `users` rows — there is no
 * way to fake an id that the assignee picker, the workload report and the
 * people map would all accept. What stops them being accounts is that they have
 * **no password hash**, and `verifyPassword` compares against an empty string,
 * which bcrypt never matches; and that their addresses are on the reserved
 * `.invalid` domain, which cannot be registered, so the Google identity path
 * has nothing to match either and no mail can ever leave the building.
 *
 * They are created *active* rather than disabled, which is the one place this
 * differs from the Projects demo loader. An inactive account is filtered out of
 * the people picker and refused by `assertAssignable`, so a demo team would
 * show up as ten disabled users nobody could reassign work to — which is the
 * opposite of what a demo of a production workflow is for. The lock that
 * matters is the missing password, and that one is not relaxed.
 *
 * It writes with direct SQL rather than through the services, which is the
 * deliberate trade in ADR terms: the services enforce the workflow one
 * transition at a time (you cannot approve a version that was never submitted),
 * and reproducing a year of production history through them would mean either
 * hundreds of sequenced calls or weakening the rules everybody else relies on.
 * The rules stay untouched; this file stays out of `server/`.
 */

import crypto from 'node:crypto';
import process from 'node:process';

import { SCHEMA as S, init, close, query, transaction } from '../server/learningProduction/db.js';
import { create, find, getStore, putBlob, removeBlob } from '../server/store.js';
import { isActiveUser } from '../shared/permissions.js';
import { organizationOf } from '../shared/organization.js';
import { ASSET_TYPES } from '../shared/learningProduction/constants.js';

import { coverPng, narrationWav, slidesPdf } from './learning-demo/media.js';
import {
  COURSES,
  PEOPLE,
  PLANS,
  PPT_COMMENTS,
  SCRIPT_COMMENTS,
  VERSION_NOTES,
  VIDEO_CHECKLIST,
  VIDEO_COMMENTS,
  VOICE_COMMENTS,
  blueprintTotals,
  outlineFor,
  scriptFor,
  slidesFor,
} from './learning-demo/blueprint.js';

const DEMO_EMAIL_DOMAIN = 'demo.qodo.invalid';

/* ── small helpers ────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const found = args.find((value) => value.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};

const DAY = 24 * 60 * 60 * 1000;
const START = Date.now();

/** A calendar day `n` days from today, as the `date` columns store it. */
const day = (offset) => new Date(START + offset * DAY).toISOString().slice(0, 10);
/** An instant `n` days ago (plus a few hours of jitter), for back-dated history. */
const ago = (days, hours = 0) => new Date(START - days * DAY - hours * 3600_000).toISOString();

/**
 * A deterministic stream of small numbers.
 *
 * The demo has to be *varied* but not *random*: two people loading it should be
 * looking at the same screens when one of them asks the other about a row.
 */
function sequence(seed) {
  let state = seed >>> 0 || 1;
  return (bound) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % bound;
  };
}

/**
 * Activity, buffered.
 *
 * The log is read newest-first by *id*, because in the running product a row is
 * written at the moment the thing happens and the two orders are the same. A
 * loader builds the history out of order — every version of an asset, then the
 * next asset — so the rows are collected here and written at the end in the
 * order they happened. Otherwise a course's history reads as all of its video
 * events, then all of its voice-over events, each internally backwards.
 */
const activityRows = [];

function logActivity(row) {
  activityRows.push(row);
}

async function flushActivity() {
  activityRows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const row of activityRows) {
    await query(
      `INSERT INTO ${S}.learning_activity_log
         (organization_id, course_id, lesson_id, asset_id, version_id, actor_user_id, event_type, metadata_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        row.organizationId,
        row.courseId ?? null,
        row.lessonId ?? null,
        row.assetId ?? null,
        row.versionId ?? null,
        row.actorUserId ?? null,
        row.eventType,
        JSON.stringify(row.metadata ?? {}),
        row.createdAt,
      ]
    );
  }
  const written = activityRows.length;
  activityRows.length = 0;
  return written;
}

function say(message) {
  process.stdout.write(`${message}\n`);
}

function die(message) {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

/* ── guards ───────────────────────────────────────────────────────── */

if (process.env.NODE_ENV === 'production') {
  die('Refusing to run: NODE_ENV is production. This tool is for development databases only.');
}
if (!process.env.DATABASE_URL) {
  die(
    'DATABASE_URL is not set, and E-Learning Production needs its PostgreSQL schema.\n' +
      'Start one with `node scripts/dev-postgres.js` and put the URL it prints into .env.local.'
  );
}

/* ── who the data belongs to ──────────────────────────────────────── */

/**
 * The organization to load into, and the real person the demo points at.
 *
 * "My Work" and the review queue are lists of *your* work; a demo in which
 * every task belongs to a fictional colleague shows two empty screens. So one
 * real account — the first active administrator, or `--for=<email|id>` — is
 * made the manager of one course and is given assignments and reviews of its
 * own across the others.
 */
async function resolveContext() {
  const users = await find('users');
  const wanted = option('for');
  const real = users.filter((user) => !user.isDemo && isActiveUser(user));
  const viewer = wanted
    ? real.find((user) => user.id === wanted || String(user.email ?? '').toLowerCase() === wanted.toLowerCase())
    : real.find((user) => user.role === 'admin') ?? real[0];

  if (!viewer) {
    die(
      wanted
        ? `No active user matches --for=${wanted}.`
        : 'No active user found in the workspace store. Sign in once (or run the workspace seed) before loading the demo.'
    );
  }

  const organizationId = option('org') ?? organizationOf(viewer);
  return { viewer, organizationId };
}

/* ── removal ──────────────────────────────────────────────────────── */

/**
 * Take it all out again.
 *
 * Three of these tables refuse deletes at the database level, and two more are
 * append-only — on purpose, because a *version* and a *review decision* are
 * evidence and the services must never be able to rewrite them. A demo loader
 * is the one caller that legitimately needs the row gone, so it switches the
 * triggers off for the length of one transaction and back on by ending it.
 * `session_replication_role` is session-scoped and `SET LOCAL` unwinds at
 * COMMIT, so nothing outside this transaction is ever running without them.
 */
async function removeDemo(organizationId) {
  const { rows: courses } = await query(`SELECT id, name FROM ${S}.learning_courses WHERE organization_id = $1 AND is_demo`, [organizationId]);
  if (courses.length === 0) {
    say('No demo courses in this organization.');
  } else {
    const ids = courses.map((course) => course.id);
    const { rows: covers } = await query(`SELECT cover_storage_key FROM ${S}.learning_courses WHERE id = ANY($1::uuid[]) AND cover_storage_key IS NOT NULL`, [ids]);
    const { rows: files } = await query(
      `SELECT v.storage_key, v.preview_storage_key FROM ${S}.learning_asset_versions v
         JOIN ${S}.learning_assets a ON a.id = v.asset_id WHERE a.course_id = ANY($1::uuid[])`,
      [ids]
    );

    await transaction(async (tx) => {
      // Only this transaction, and only while it lasts.
      await tx.query(`SET LOCAL session_replication_role = replica`);
      const byCourse = (table, column = 'course_id') => tx.query(`DELETE FROM ${S}.${table} WHERE ${column} = ANY($1::uuid[])`, [ids]);
      const byAsset = (table) =>
        tx.query(`DELETE FROM ${S}.${table} WHERE asset_id IN (SELECT id FROM ${S}.learning_assets WHERE course_id = ANY($1::uuid[]))`, [ids]);

      await byAsset('learning_notifications');
      await byAsset('learning_annotations');
      await byAsset('learning_audio_markers');
      await byAsset('learning_video_markers');
      await byAsset('learning_transcripts');
      await byAsset('learning_comments');
      await byCourse('learning_checklist_items', 'checklist_id');
      await tx.query(
        `DELETE FROM ${S}.learning_checklist_items WHERE checklist_id IN (SELECT id FROM ${S}.learning_checklists WHERE course_id = ANY($1::uuid[]))`,
        [ids]
      );
      await byCourse('learning_checklists');
      await byCourse('learning_activity_log');
      await byAsset('learning_asset_approvals');
      await byAsset('learning_asset_assignments');
      await byAsset('learning_asset_drafts');
      await tx.query(`UPDATE ${S}.learning_assets SET current_version_id = NULL, approved_version_id = NULL, changes_requested_version_id = NULL WHERE course_id = ANY($1::uuid[])`, [ids]);
      await byAsset('learning_asset_versions');
      await byCourse('learning_assets');
      await byCourse('learning_lessons');
      await byCourse('learning_course_modules');
      await byCourse('learning_course_members');
      await tx.query(`DELETE FROM ${S}.learning_courses WHERE id = ANY($1::uuid[])`, [ids]);
    });

    for (const key of [...covers.map((row) => row.cover_storage_key), ...files.flatMap((row) => [row.storage_key, row.preview_storage_key])]) {
      if (key) await removeBlob(key).catch(() => {});
    }
    say(`Removed ${courses.length} demo courses and everything under them.`);
  }

  const store = await getStore();
  const people = await find('users', (user) => user.isDemo && organizationOf(user) === organizationId && String(user.email ?? '').endsWith(DEMO_EMAIL_DOMAIN));
  let removed = 0;
  for (const person of people) {
    if (await store.remove('users', person.id)) removed += 1;
  }
  if (removed) say(`Removed ${removed} demo accounts.`);
}

/* ── the load ─────────────────────────────────────────────────────── */

/** The five stages' default maker and reviewer for a course, resolved to ids. */
function stagePeople(course, ids) {
  const resolved = {};
  for (const type of ASSET_TYPES) {
    const [maker, reviewer] = course.defaults[type];
    resolved[type] = { assignee: ids[maker], reviewer: ids[reviewer] };
  }
  return resolved;
}

/** Which statuses have how many versions behind them, and what happened to each. */
function versionPlan(status, pick) {
  switch (status) {
    case 'NOT_STARTED':
    case 'ASSIGNED':
      return [];
    case 'IN_PROGRESS':
      return pick(2) === 0 ? [] : [{ decision: null }];
    case 'SUBMITTED':
      return [{ decision: 'PENDING' }];
    case 'UNDER_REVIEW':
      // A first submission and a third attempt are different rows in the review
      // queue — `needsReview` against `resubmitted` — so both have to exist.
      switch (pick(3)) {
        case 0:
          return [{ decision: 'PENDING' }];
        case 1:
          return [{ decision: 'CHANGES_REQUESTED' }, { decision: 'PENDING' }];
        default:
          return [{ decision: 'CHANGES_REQUESTED' }, { decision: 'CHANGES_REQUESTED' }, { decision: 'PENDING' }];
      }
    case 'RESUBMITTED':
      return [{ decision: 'CHANGES_REQUESTED' }, { decision: 'PENDING' }];
    case 'CHANGES_REQUESTED':
      return pick(2) === 0 ? [{ decision: 'CHANGES_REQUESTED' }] : [{ decision: 'CHANGES_REQUESTED' }, { decision: 'CHANGES_REQUESTED' }];
    default:
      return pick(3) === 0 ? [{ decision: 'CHANGES_REQUESTED' }, { decision: 'APPROVED' }] : [{ decision: 'APPROVED' }];
  }
}

/**
 * Due dates that put something in every bucket the filters offer.
 *
 * Which of the two lists an asset draws from is the course's `lateness`, not
 * chance — see the note on it in the blueprint. A demo where every course is
 * equally late would show one course-health state seven times.
 */
const FUTURE_OFFSETS = [0, 1, 2, 4, 6, 9, 13, 20, null, 3, 7, 16];
const LATE_OFFSETS = [-1, -3, -6, -9, -2, -14, -5];
const PRIORITY_CYCLE = ['NORMAL', 'NORMAL', 'HIGH', 'NORMAL', 'LOW', 'NORMAL', 'URGENT', 'NORMAL', 'NORMAL', 'HIGH'];

async function load({ viewer, organizationId }) {
  const existing = await query(`SELECT count(*)::int AS n FROM ${S}.learning_courses WHERE organization_id = $1 AND is_demo`, [organizationId]);
  if (existing.rows[0].n > 0) {
    die(`This organization already has ${existing.rows[0].n} demo courses. Run with --reset to rebuild them, or --remove to take them out.`);
  }

  /* people ------------------------------------------------------- */

  const ids = { viewer: viewer.id };
  let createdPeople = 0;
  for (const person of PEOPLE) {
    const email = `${person.ref}@${DEMO_EMAIL_DOMAIN}`;
    const found = await find('users', (user) => String(user.email ?? '').toLowerCase() === email && organizationOf(user) === organizationId);
    if (found[0]) {
      ids[person.ref] = found[0].id;
      continue;
    }
    const created = await create('users', {
      name: person.name,
      email,
      // No hash and no way to set one: `isActiveUser` is false, so the login
      // route refuses the account before any comparison happens.
      passwordHash: null,
      role: 'member',
      organizationId,
      status: 'active',
      permissions: null,
      appIds: null,
      department: 'e-learning',
      subteam: null,
      jobRole: null,
      title: person.title,
      avatarColor: person.avatarColor,
      lastLoginAt: null,
      isDemo: true,
    });
    ids[person.ref] = created.id;
    createdPeople += 1;
  }
  say(`People: ${createdPeople} created, ${PEOPLE.length - createdPeople} reused.`);

  /* courses ------------------------------------------------------ */

  const counts = { courses: 0, lessons: 0, assets: 0, versions: 0, comments: 0, activity: 0, blobs: 0 };

  for (const [courseIndex, course] of COURSES.entries()) {
    const pick = sequence(1000 + courseIndex * 97);
    const people = stagePeople(course, ids);
    const managerId = ids[course.managerRef];
    const coverKey = `lp_${crypto.randomUUID()}`;
    await putBlob(coverKey, coverPng(course.cover));
    counts.blobs += 1;

    const courseRow = await query(
      `INSERT INTO ${S}.learning_courses
         (organization_id, name, code, description, cover_storage_key, cover_mime_type, manager_user_id,
          status, priority, start_date, target_date, settings_json, production_defaults_json, is_demo,
          created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'image/png',$6,$7,$8,$9,$10,'{}'::jsonb,$11,true,$12,$13,$13)
       RETURNING id`,
      [
        organizationId,
        course.name,
        course.code,
        course.description,
        coverKey,
        managerId,
        'ACTIVE',
        course.priority,
        day(course.startOffset),
        day(course.targetOffset),
        JSON.stringify(
          Object.fromEntries(ASSET_TYPES.map((type) => [type, { assigneeUserId: people[type].assignee, reviewerUserId: people[type].reviewer }]))
        ),
        viewer.id,
        ago(Math.abs(course.startOffset)),
      ]
    );
    const courseId = courseRow.rows[0].id;
    counts.courses += 1;

    for (const [ref, roles] of Object.entries(course.team)) {
      await query(
        `INSERT INTO ${S}.learning_course_members (organization_id, course_id, user_id, roles, added_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4::text[],$5,$6,$6)`,
        [organizationId, courseId, ids[ref], roles, viewer.id, ago(Math.abs(course.startOffset))]
      );
    }
    if (!course.team.viewer && managerId !== viewer.id) {
      // The viewer sees every course anyway if they hold the module's view key;
      // being on the team is what makes the workload and picker lists honest.
      await query(
        `INSERT INTO ${S}.learning_course_members (organization_id, course_id, user_id, roles, added_by, created_at, updated_at)
         VALUES ($1,$2,$3,ARRAY['VIEWER']::text[],$4,$5,$5) ON CONFLICT DO NOTHING`,
        [organizationId, courseId, viewer.id, viewer.id, ago(Math.abs(course.startOffset))]
      );
    }

    // The course's QA template for video, the same list a real course is created with.
    const template = await query(
      `INSERT INTO ${S}.learning_checklists (organization_id, course_id, asset_type, is_template, created_by)
       VALUES ($1,$2,'VIDEO',true,$3) RETURNING id`,
      [organizationId, courseId, viewer.id]
    );
    for (const [order, item] of VIDEO_CHECKLIST.entries()) {
      await query(
        `INSERT INTO ${S}.learning_checklist_items (organization_id, checklist_id, sort_order, category, label, required, status)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING')`,
        [organizationId, template.rows[0].id, order, item.category, item.label, item.category !== 'TRANSITIONS']
      );
    }

    logActivity({ organizationId, courseId, actorUserId: viewer.id, eventType: 'COURSE_CREATED', createdAt: ago(Math.abs(course.startOffset)) });
    counts.activity += 1;

    /* modules and lessons ---------------------------------------- */

    let lessonNumber = 0;
    for (const [moduleIndex, module] of course.modules.entries()) {
      const moduleRow = await query(
        `INSERT INTO ${S}.learning_course_modules (organization_id, course_id, name, sort_order, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`,
        [organizationId, courseId, module.name, moduleIndex, ago(Math.abs(course.startOffset) - 1)]
      );
      const moduleId = moduleRow.rows[0].id;

      for (const lessonName of module.lessons) {
        const planKey = course.overrides[lessonName] ?? course.mix[lessonNumber % course.mix.length];
        const plan = PLANS[planKey];
        const createdAt = ago(Math.max(2, Math.abs(course.startOffset) - 2 - lessonNumber));

        const lessonRow = await query(
          `INSERT INTO ${S}.learning_lessons
             (organization_id, course_id, module_id, name, description, sort_order,
              estimated_duration_minutes, owner_user_id, target_date, created_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id`,
          [
            organizationId,
            courseId,
            moduleId,
            lessonName,
            `Lesson ${lessonNumber + 1} of ${course.name}.`,
            lessonNumber,
            10 + (pick(14) + lessonNumber) % 16,
            ids[Object.keys(course.team)[lessonNumber % Object.keys(course.team).length]] ?? managerId,
            day(course.targetOffset - 14 + (lessonNumber % 12)),
            viewer.id,
            createdAt,
          ]
        );
        const lessonId = lessonRow.rows[0].id;
        counts.lessons += 1;

        logActivity({ organizationId, courseId, lessonId, actorUserId: viewer.id, eventType: 'LESSON_CREATED', createdAt });
        counts.activity += 1;

        const outline = outlineFor(lessonName, course);
        const script = scriptFor(lessonName, course);

        for (const [stageIndex, assetType] of ASSET_TYPES.entries()) {
          await buildAsset({
            organizationId,
            viewer,
            course,
            courseId,
            lessonId,
            lessonName,
            lessonNumber,
            assetType,
            stageIndex,
            status: plan[stageIndex],
            people: people[assetType],
            ids,
            pick,
            outline,
            script,
            counts,
          });
        }

        lessonNumber += 1;
      }
    }

    say(`  ${course.name} — ${lessonNumber} lessons.`);
  }

  await flushActivity();
  await backdate(organizationId);

  say('');
  say(`Loaded ${counts.courses} courses, ${counts.lessons} lessons, ${counts.assets} assets, ${counts.versions} versions, ${counts.comments} comments, ${counts.activity} activity entries.`);
  say(`Signed in as ${viewer.name}: you manage ${COURSES[0].name}, and work and reviews of your own are waiting in My Work and Reviews.`);
}

/**
 * Put the clocks back.
 *
 * Every table here carries a `touch_updated_at` trigger, so the second pass
 * that moves an asset into its real state also stamps it as changed *now* —
 * and a demo in which all four hundred assets were last touched two minutes
 * ago reads as a database dump rather than as a studio with six weeks of work
 * behind it. This walks each row back to the last thing that actually happened
 * to it, with the triggers off for the length of one transaction.
 */
async function backdate(organizationId) {
  await transaction(async (tx) => {
    await tx.query(`SET LOCAL session_replication_role = replica`);
    await tx.query(
      `UPDATE ${S}.learning_assets a
          SET updated_at = COALESCE(
                (SELECT max(e.created_at) FROM ${S}.learning_activity_log e WHERE e.asset_id = a.id),
                a.created_at)
        FROM ${S}.learning_courses c
       WHERE c.id = a.course_id AND c.organization_id = $1 AND c.is_demo`,
      [organizationId]
    );
    await tx.query(
      `UPDATE ${S}.learning_lessons l
          SET updated_at = COALESCE((SELECT max(a.updated_at) FROM ${S}.learning_assets a WHERE a.lesson_id = l.id), l.created_at)
        FROM ${S}.learning_courses c
       WHERE c.id = l.course_id AND c.organization_id = $1 AND c.is_demo`,
      [organizationId]
    );
    await tx.query(
      `UPDATE ${S}.learning_courses c
          SET updated_at = COALESCE((SELECT max(l.updated_at) FROM ${S}.learning_lessons l WHERE l.course_id = c.id), c.created_at)
        WHERE c.organization_id = $1 AND c.is_demo`,
      [organizationId]
    );
  });
}

/**
 * One asset, with the history its status implies.
 *
 * Every column the workflow sets is set here in the same combination the
 * services would have left behind — a `CHANGES_REQUESTED` asset points at the
 * version that was refused, an `APPROVED` one points at the version that was
 * accepted and carries who accepted it, and `LOCKED` carries the timestamp the
 * database's own CHECK insists on. Anything less produces rows that render but
 * that the real actions then refuse to act on.
 */
async function buildAsset(context) {
  const { organizationId, viewer, course, courseId, lessonId, lessonName, lessonNumber, assetType, stageIndex, status, people, ids, pick, outline, script, counts } = context;

  const slot = lessonNumber * 5 + stageIndex;
  const complete = status === 'APPROVED' || status === 'LOCKED';
  // A course that is behind is behind *somewhere* — a plant's decks slip, or its
  // scripts do, not one asset in three at random. `lateStages` says where.
  const lateStage = (course.lateStages ?? []).includes(assetType);
  const late = !complete && (lateStage ? lessonNumber % 3 !== 2 : (slot * 37) % 100 < Math.round((course.lateness ?? 0) * 100));
  const dueOffset = complete
    ? -(6 + (slot % 30))
    : late
      ? LATE_OFFSETS[slot % LATE_OFFSETS.length]
      : FUTURE_OFFSETS[slot % FUTURE_OFFSETS.length];
  const priority = PRIORITY_CYCLE[slot % PRIORITY_CYCLE.length];
  const assignee = people.assignee ?? null;
  const reviewer = people.reviewer && people.reviewer !== assignee ? people.reviewer : ids.dina;
  const started = status !== 'NOT_STARTED';
  const age = 4 + (slot % 26);
  // Work always starts before it is due, including for the assets whose due
  // date is already in the past — the table has a CHECK that says so.
  const startedOn = -Math.max(age, dueOffset !== null && dueOffset < 0 ? Math.abs(dueOffset) + 3 : 0);

  const asset = await query(
    `INSERT INTO ${S}.learning_assets
       (organization_id, course_id, lesson_id, asset_type, status, priority, assignee_user_id, reviewer_user_id,
        start_date, due_date, assigned_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
    [
      organizationId,
      courseId,
      lessonId,
      assetType,
      // Set plainly first; the history below moves it to its real state.
      'NOT_STARTED',
      priority,
      started ? assignee : null,
      started ? reviewer : null,
      started ? day(startedOn) : null,
      dueOffset === null ? null : day(dueOffset),
      started ? ago(age) : null,
      ago(age + 1),
    ]
  );
  const assetId = asset.rows[0].id;
  counts.assets += 1;

  if (started) {
    await query(
      `INSERT INTO ${S}.learning_asset_assignments (organization_id, asset_id, assignee_user_id, reviewer_user_id, due_date, priority, assigned_by, assigned_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [organizationId, assetId, assignee, reviewer, dueOffset === null ? null : day(dueOffset), priority, ids[course.managerRef] ?? viewer.id, ago(age)]
    );
    logActivity({ organizationId, courseId, lessonId, assetId, actorUserId: ids[course.managerRef] ?? viewer.id, eventType: 'ASSET_ASSIGNED', createdAt: ago(age) });
    counts.activity += 1;
  }

  const versions = versionPlan(status, pick);
  if (versions.length === 0) {
    if (status !== 'NOT_STARTED') {
      await query(`UPDATE ${S}.learning_assets SET status = $2, work_started_at = $3 WHERE id = $1`, [assetId, status, status === 'ASSIGNED' ? null : ago(age - 1)]);
      // A text asset being written has a draft, which is what autosave writes to.
      if ((assetType === 'OUTLINE' || assetType === 'SCRIPT') && status === 'IN_PROGRESS') {
        await query(
          `INSERT INTO ${S}.learning_asset_drafts (asset_id, organization_id, content_json, revision, updated_by, updated_at)
           VALUES ($1,$2,$3::jsonb,$4,$5,$6)`,
          [assetId, organizationId, JSON.stringify(assetType === 'OUTLINE' ? outline : script), 3 + pick(9), assignee, ago(1, 3)]
        );
      }
    }
    return;
  }

  let currentVersionId = null;
  let approvedVersionId = null;
  let changesVersionId = null;
  let lastUpload = null;

  for (const [index, entry] of versions.entries()) {
    const number = index + 1;
    const uploadedAt = ago(Math.max(1, age - 2 - index * 3), index);
    lastUpload = uploadedAt;
    const media = await versionMedia({ assetType, lessonName, course, script, outline, number, slot });

    const version = await query(
      `INSERT INTO ${S}.learning_asset_versions
         (organization_id, asset_id, version_number, source_kind, storage_key, file_name, mime_type, file_size,
          external_url, content_json, duration_seconds, version_notes, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14) RETURNING id`,
      [
        organizationId,
        assetId,
        number,
        media.sourceKind,
        media.storageKey,
        media.fileName,
        media.mimeType,
        media.fileSize,
        media.externalUrl,
        media.content ? JSON.stringify(media.content) : null,
        media.durationSeconds,
        VERSION_NOTES[number] ?? `Revision ${number}.`,
        assignee ?? viewer.id,
        uploadedAt,
      ]
    );
    const versionId = version.rows[0].id;
    currentVersionId = versionId;
    counts.versions += 1;
    if (media.storageKey) counts.blobs += 1;

    logActivity({ organizationId, courseId, lessonId, assetId, versionId, actorUserId: assignee, eventType: 'VERSION_UPLOADED', metadata: { versionNumber: number }, createdAt: uploadedAt });
    counts.activity += 1;

    if (!entry.decision) continue;

    const submittedAt = ago(Math.max(1, age - 2 - index * 3), index + 1);
    const reviewedAt = entry.decision === 'PENDING' ? null : ago(Math.max(0, age - 3 - index * 3), index + 2);
    await query(
      `INSERT INTO ${S}.learning_asset_approvals
         (organization_id, asset_id, version_id, submitted_by, submitted_at, is_resubmission, reviewer_user_id,
          decision, review_started_at, reviewed_by, reviewed_at, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        organizationId,
        assetId,
        versionId,
        assignee,
        submittedAt,
        index > 0,
        reviewer,
        entry.decision,
        entry.decision === 'PENDING' && status === 'UNDER_REVIEW' ? ago(0, 6) : reviewedAt,
        entry.decision === 'PENDING' ? null : reviewer,
        reviewedAt,
        entry.decision === 'CHANGES_REQUESTED' ? 'A few corrections before this can be approved — see the comments on the version.' : entry.decision === 'APPROVED' ? 'Approved. Good work.' : '',
      ]
    );
    logActivity({
      organizationId,
      courseId,
      lessonId,
      assetId,
      versionId,
      actorUserId: assignee,
      eventType: index > 0 ? 'RESUBMITTED' : 'SUBMITTED_FOR_REVIEW',
      metadata: { versionNumber: number },
      createdAt: submittedAt,
    });
    counts.activity += 1;

    if (entry.decision === 'CHANGES_REQUESTED') {
      changesVersionId = versionId;
      logActivity({
        organizationId,
        courseId,
        lessonId,
        assetId,
        versionId,
        actorUserId: reviewer,
        eventType: 'CHANGES_REQUESTED',
        metadata: { versionNumber: number, reason: 'See the comments on this version.' },
        createdAt: reviewedAt,
      });
      counts.activity += 1;
    }
    if (entry.decision === 'APPROVED') {
      approvedVersionId = versionId;
      logActivity({ organizationId, courseId, lessonId, assetId, versionId, actorUserId: reviewer, eventType: 'APPROVED', metadata: { versionNumber: number }, createdAt: reviewedAt });
      counts.activity += 1;
    }
  }

  const lastDecision = versions[versions.length - 1].decision;
  await query(
    `UPDATE ${S}.learning_assets SET
       status = $2,
       current_version_id = $3,
       approved_version_id = $4,
       changes_requested_version_id = $5,
       work_started_at = $6,
       submitted_at = $7,
       submitted_by = $8,
       review_started_at = $9,
       changes_requested_at = $10,
       resubmitted_at = $11,
       approved_at = $12,
       approved_by = $13,
       locked_at = $14,
       locked_by = $15,
       updated_at = $16
     WHERE id = $1`,
    [
      assetId,
      status,
      currentVersionId,
      approvedVersionId,
      lastDecision === 'CHANGES_REQUESTED' ? changesVersionId : null,
      ago(age - 1),
      lastDecision ? lastUpload : null,
      lastDecision ? assignee : null,
      status === 'UNDER_REVIEW' ? ago(0, 5) : null,
      lastDecision === 'CHANGES_REQUESTED' ? ago(Math.max(0, age - 4)) : null,
      status === 'RESUBMITTED' ? ago(0, 9) : null,
      complete ? ago(Math.max(0, age - 5)) : null,
      complete ? reviewer : null,
      status === 'LOCKED' ? ago(Math.max(0, age - 5)) : null,
      status === 'LOCKED' ? reviewer : null,
      lastUpload,
    ]
  );

  await addReviewConversation({ ...context, assetId, versionId: currentVersionId, status, reviewer, assignee, slot });
}

/** The bytes (or the content, or the link) one version of one stage is made of. */
async function versionMedia({ assetType, lessonName, course, script, outline, number, slot }) {
  const empty = { sourceKind: 'CONTENT', storageKey: null, fileName: null, mimeType: null, fileSize: null, externalUrl: null, content: null, durationSeconds: null };

  if (assetType === 'OUTLINE') return { ...empty, content: outline };
  if (assetType === 'SCRIPT') return { ...empty, content: script };

  if (assetType === 'PPT') {
    const bytes = slidesPdf({ title: `${course.code} · ${lessonName}`, slides: slidesFor(lessonName, course) });
    const key = `lp_${crypto.randomUUID()}`;
    await putBlob(key, bytes);
    return {
      ...empty,
      sourceKind: 'FILE',
      storageKey: key,
      fileName: `${course.code}-${lessonName.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-v${number}.pdf`,
      mimeType: 'application/pdf',
      fileSize: bytes.length,
      durationSeconds: null,
    };
  }

  if (assetType === 'VOICE_OVER') {
    // Short by design: a realistic four-minute recording at this sample rate
    // would be four megabytes, and the blueprint asks for dozens of them.
    const seconds = 26 + (slot % 17);
    const bytes = narrationWav({ seconds, seed: slot + number });
    const key = `lp_${crypto.randomUUID()}`;
    await putBlob(key, bytes);
    return {
      ...empty,
      sourceKind: 'FILE',
      storageKey: key,
      fileName: `${course.code}-${lessonName.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-vo-v${number}.wav`,
      mimeType: 'audio/wav',
      fileSize: bytes.length,
      durationSeconds: seconds,
    };
  }

  // Finished video lives on the studio's own delivery host in this demo — a
  // link, not bytes, because a real MP4 cannot be generated from arithmetic and
  // a fake one would fail to play and teach nothing.
  return {
    ...empty,
    sourceKind: 'LINK',
    externalUrl: `https://media.${DEMO_EMAIL_DOMAIN}/${course.code.toLowerCase()}/${lessonName.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}/v${number}`,
    durationSeconds: 180 + (slot % 120),
  };
}

/** The comments, annotations, markers, transcript and checklist of a live review. */
async function addReviewConversation(context) {
  const { organizationId, courseId, lessonId, assetId, versionId, assetType, status, reviewer, assignee, slot, counts, script } = context;
  if (!versionId) return;
  const live = status === 'UNDER_REVIEW' || status === 'CHANGES_REQUESTED' || status === 'RESUBMITTED';
  if (!live) return;

  const comment = async ({ body, type, anchor, resolved, at, author, suggestion }) => {
    const row = await query(
      `INSERT INTO ${S}.learning_comments
         (organization_id, asset_id, version_id, user_id, comment_type, body, status, anchor_json, suggestion_text, resolved_by, resolved_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$12) RETURNING id`,
      [
        organizationId,
        assetId,
        versionId,
        author ?? reviewer,
        type,
        body,
        resolved ? 'RESOLVED' : 'OPEN',
        anchor ? JSON.stringify(anchor) : null,
        suggestion ?? null,
        resolved ? assignee : null,
        resolved ? at : null,
        at,
      ]
    );
    counts.comments += 1;
    logActivity({ organizationId, courseId, lessonId, assetId, versionId, actorUserId: author ?? reviewer, eventType: 'COMMENT_CREATED', createdAt: at });
    counts.activity += 1;
    return row.rows[0].id;
  };

  if (assetType === 'PPT') {
    for (const [index, note] of PPT_COMMENTS.entries()) {
      if (index > slot % 4) break;
      const at = ago(1, index * 3 + 2);
      const id = await comment({ body: note.body, type: 'ANNOTATION', anchor: { pageNumber: note.page }, resolved: index === 3, at });
      await query(
        `INSERT INTO ${S}.learning_annotations
           (organization_id, asset_id, version_id, page_number, annotation_type, x, y, metadata_json, comment_id, created_by, created_at)
         VALUES ($1,$2,$3,$4,'PIN',$5,$6,$7::jsonb,$8,$9,$10)`,
        [organizationId, assetId, versionId, note.page, note.anchor.x, note.anchor.y, JSON.stringify({ color: '#DC2626' }), id, reviewer, at]
      );
      if (index === 0) {
        await query(
          `INSERT INTO ${S}.learning_comments (organization_id, asset_id, version_id, parent_comment_id, user_id, comment_type, body, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,'GENERAL',$6,'OPEN',$7,$7)`,
          [organizationId, assetId, versionId, id, assignee, 'Fixed on this slide and the two after it — will be in the next version.', ago(0, 20)]
        );
        counts.comments += 1;
      }
    }
    return;
  }

  if (assetType === 'VOICE_OVER') {
    for (const [index, note] of VOICE_COMMENTS.entries()) {
      if (index > slot % 3) break;
      const at = ago(1, index * 4 + 1);
      const id = await comment({ body: note.body, type: 'AUDIO_TIMESTAMP', resolved: Boolean(note.resolved), at });
      await query(
        `INSERT INTO ${S}.learning_audio_markers (organization_id, asset_id, version_id, start_seconds, end_seconds, comment_id, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        // The generated clips are shorter than a real recording, so the marker
        // is placed inside the file rather than at the blueprint's timestamp.
        [organizationId, assetId, versionId, (note.start % 24) + 2, note.end ? (note.start % 24) + 9 : null, id, reviewer, at]
      );
    }
    await query(
      `INSERT INTO ${S}.learning_transcripts (organization_id, asset_id, version_id, source, body, segments_json, updated_by)
       VALUES ($1,$2,$3,'MANUAL',$4,$5::jsonb,$6)`,
      [
        organizationId,
        assetId,
        versionId,
        script.blocks.map((block) => block.narration).join('\n\n'),
        JSON.stringify(script.blocks.map((block, index) => ({ startSeconds: index * 6, endSeconds: index * 6 + 5, text: block.narration.slice(0, 160) }))),
        reviewer,
      ]
    );
    return;
  }

  if (assetType === 'VIDEO') {
    for (const [index, note] of VIDEO_COMMENTS.entries()) {
      if (index > slot % 3) break;
      const at = ago(1, index * 5 + 2);
      const id = await comment({ body: note.body, type: 'VIDEO_TIMESTAMP', resolved: false, at });
      await query(
        `INSERT INTO ${S}.learning_video_markers (organization_id, asset_id, version_id, start_seconds, end_seconds, frame_timestamp, annotation_json, comment_id, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
        [
          organizationId,
          assetId,
          versionId,
          note.start,
          note.end,
          index === 0 ? note.start : null,
          index === 0 ? JSON.stringify([{ annotationType: 'RECTANGLE', geometry: { x: 0.18, y: 0.62, width: 0.34, height: 0.12 }, color: '#F5821F' }]) : null,
          id,
          reviewer,
          at,
        ]
      );
    }

    if (status === 'UNDER_REVIEW') {
      const checklist = await query(
        `INSERT INTO ${S}.learning_checklists (organization_id, course_id, asset_type, asset_id, version_id, is_template, created_by)
         VALUES ($1,$2,'VIDEO',$3,$4,false,$5) RETURNING id`,
        [organizationId, courseId, assetId, versionId, reviewer]
      );
      for (const [order, item] of VIDEO_CHECKLIST.entries()) {
        await query(
          `INSERT INTO ${S}.learning_checklist_items (organization_id, checklist_id, sort_order, category, label, required, status, notes, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [organizationId, checklist.rows[0].id, order, item.category, item.label, item.category !== 'TRANSITIONS', item.status, item.notes ?? '', reviewer]
        );
      }
    }
    return;
  }

  if (assetType === 'SCRIPT') {
    for (const [index, note] of SCRIPT_COMMENTS.entries()) {
      if (index > slot % 2) break;
      await comment({
        body: note.body,
        type: note.suggestion ? 'SUGGESTION' : 'SCRIPT_BLOCK',
        anchor: { blockId: note.block },
        resolved: false,
        at: ago(1, index * 6 + 3),
        suggestion: note.suggestion,
      });
    }
    return;
  }

  await comment({ body: 'Objectives two and three overlap — can we merge them before this goes to the deck?', type: 'GENERAL', resolved: false, at: ago(1, 4) });
}

/* ── main ─────────────────────────────────────────────────────────── */

async function main() {
  await init();
  const context = await resolveContext();
  say(`Organization: ${context.organizationId}`);

  if (flag('remove') || flag('reset')) await removeDemo(context.organizationId);
  if (flag('remove')) return;

  const totals = blueprintTotals();
  say(`Loading ${totals.courses} courses, ${totals.lessons} lessons and ${totals.assets} assets…`);
  await load(context);
}

main()
  .then(async () => {
    await close();
    process.exit(0);
  })
  .catch(async (error) => {
    process.stderr.write(`\n${error?.stack ?? error}\n\n`);
    await close().catch(() => {});
    process.exit(1);
  });
