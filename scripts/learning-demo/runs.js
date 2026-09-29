/**
 * The production-run half of the demo.
 *
 * The lesson half (seed-learning-demo.js) writes a year of asset history with
 * direct SQL. Runs are different: every screen of the rebuilt module is a view
 * of what the workflow rules decided — which stage is blocked and why, which
 * approval binds to which submission, whether a release is ready — and SQL
 * written by hand would only show what this file *thinks* the rules decide. So
 * runs are walked through the real services, as the people named on each task,
 * exactly as the API would call them. If a rule changes, the demo follows it or
 * fails loudly; it never shows a state the product cannot reach.
 *
 * What it leaves behind, one run per state a reviewer needs to see:
 *
 *   • every blueprint course keeps its history under a LEGACY run, as the
 *     migration backfill does for real data; one of them has adopted a workflow;
 *   • an expert-led program walked from research to a published release, and a
 *     revamp of that release with its change impact waiting for approval;
 *   • an expert-led program in its first weeks: research done, a draft
 *     resubmitted after changes, expert candidates in several states, late work;
 *   • an AI-assisted program with AI-labelled outlines waiting for your review;
 *   • a program in its dry-run fixes with open, fixed and verified issues;
 *   • a program on hold.
 *
 * Alerts are muted for the length of the load (and the viewer's own preference
 * restored afterwards), so a demo load does not ring anyone's bell a hundred
 * times.
 */

import { SCHEMA as S, query } from '../../server/learningProduction/db.js';
import { find } from '../../server/store.js';
import { PREFERENCE_EVENTS } from '../../server/learningProduction/notifications.js';
import { narrationWav, slidesPdf } from './media.js';

const DAY = 86_400_000;
const day = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

/** Who does what on the new runs. The viewer is the production manager. */
export const RUN_TEAM = {
  hala: ['COURSE_MANAGER'],
  reem: ['RESEARCHER'],
  nour: ['INSTRUCTIONAL_DESIGNER'],
  yasmin: ['EXPERT_COORDINATOR'],
  adel: ['TECHNICAL_CONSULTANT'],
  khaled: ['SUBJECT_MATTER_EXPERT'],
  mahmoud: ['TECHNICAL_PM'],
  ali: ['LEARNING_OPERATIONS'],
  noha: ['MARKETING'],
  ziad: ['UAT_COORDINATOR'],
  fatma: ['UAT_TESTER'],
  dina: ['QUALITY_REVIEWER'],
  rania: ['OUTLINE_WRITER'],
  mona: ['SCRIPT_WRITER'],
  ahmed: ['PPT_DESIGNER'],
  omar: ['VOICE_OVER_ARTIST'],
  youssef: ['VIDEO_EDITOR'],
};

/** Which demo person makes and which reviews each lesson asset. */
const ASSET_PEOPLE = {
  OUTLINE: ['rania', 'khaled'],
  PPT: ['ahmed', 'dina'],
  SCRIPT: ['mona', 'khaled'],
  VOICE_OVER: ['omar', 'dina'],
  VIDEO: ['youssef', 'dina'],
};

export async function seedRuns({ viewer, organizationId, ids, say }) {
  const access = await import('../../server/learningProduction/access.js');
  const runs = await import('../../server/learningProduction/services/runService.js');
  const tasks = await import('../../server/learningProduction/services/taskService.js');
  const issues = await import('../../server/learningProduction/services/issueService.js');
  const releases = await import('../../server/learningProduction/services/releaseService.js');
  const impact = await import('../../server/learningProduction/services/impactService.js');
  const experts = await import('../../server/learningProduction/services/expertService.js');
  const lessons = await import('../../server/learningProduction/services/lessonService.js');
  const assets = await import('../../server/learningProduction/services/assetService.js');
  const comments = await import('../../server/learningProduction/services/commentService.js');
  const tools = await import('../../server/learningProduction/services/reviewToolsService.js');

  const everyone = await find('users');
  const userOf = Object.fromEntries(everyone.map((user) => [user.id, user]));
  const refOf = Object.fromEntries(Object.entries(ids).map(([ref, id]) => [id, ref]));
  const actor = (ref) => access.actorFor(userOf[ids[ref]]);
  const team = Object.entries(RUN_TEAM).map(([ref, roles]) => ({ userId: ids[ref], roles }));
  const touched = { courses: [], runs: [] };

  /* ── alerts off while loading ─────────────────────────────────── */

  const muted = [...PREFERENCE_EVENTS];
  const people = Object.values(ids);
  const saved = await query(`SELECT * FROM ${S}.learning_notification_preferences WHERE user_id = ANY($1::text[])`, [people]);
  for (const userId of people) {
    await query(
      `INSERT INTO ${S}.learning_notification_preferences (user_id, organization_id, muted_events) VALUES ($1, $2, $3::text[])
       ON CONFLICT (user_id) DO UPDATE SET muted_events = EXCLUDED.muted_events`,
      [userId, organizationId, muted]
    );
  }

  /* ── helpers, the same moves the acceptance tests make ────────── */

  const taskId = async (runId, key) => {
    const found = await query(`SELECT id FROM ${S}.learning_task_instances WHERE run_id = $1 AND task_key = $2`, [runId, key]);
    if (!found.rows[0]) throw new Error(`demo: no task ${key}`);
    return found.rows[0].id;
  };
  const stageOf = async (runId, key) => (await runs.getRun(actor('viewer'), runId)).stages.find((stage) => stage.key === key);

  const makerOf = (task) => (task.assigneeUserId && refOf[task.assigneeUserId]) || 'viewer';
  const deciderOf = (task, maker) => {
    const named = task.reviewerUserId && refOf[task.reviewerUserId];
    if (named && named !== maker) return named;
    return maker === 'viewer' ? 'hala' : 'viewer';
  };

  async function finishTask(id, { evidence, submitOnly = false } = {}) {
    const detail = await tasks.getTask(actor('viewer'), id);
    const task = detail.task;
    if (task.kind === 'AUTO' || ['DONE', 'APPROVED', 'WAIVED'].includes(task.status)) return detail;
    const maker = makerOf(task);
    for (const item of detail.checklist) {
      if (item.status === 'PENDING') await tasks.updateChecklistItem(actor(maker), item.id, { status: 'DONE' });
    }
    if (task.requiresEvidence && detail.evaluation.evidenceCount === 0) {
      await tasks.addEvidence(actor(maker), id, evidence ?? { url: `https://docs.demo.qodo.invalid/${task.key}`, note: 'Working copy' });
    }
    if (!task.requiresApproval) return tasks.completeTask(actor(maker), id, {});
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(task.status)) await tasks.submitTask(actor(maker), id, {});
    if (submitOnly) return null;
    return tasks.approveTask(actor(deciderOf(task, maker)), id, {});
  }

  async function finishStage(runId, key, { except = [] } = {}) {
    const stage = await stageOf(runId, key);
    if (stage.status === 'BLOCKED') throw new Error(`demo: ${key} is blocked by ${JSON.stringify(stage.blockers)}`);
    for (const entry of stage.tasks) {
      if (entry.kind === 'AUTO' || entry.classification === 'OPTIONAL' || except.includes(entry.key)) continue;
      await finishTask(entry.id);
    }
  }

  async function createLessons(courseId, moduleName, names) {
    const created = await lessons.createLessons(actor('viewer'), courseId, { items: names.map((name) => ({ name, moduleName })) });
    return created.lessons.map((lesson) => ({ id: lesson.id, name: lesson.name }));
  }

  const deck = (name) => [
    { title: name, bullets: ['Why it matters on site', 'What you will be able to do'] },
    { title: 'The method', bullets: ['Standard procedure', 'Worked example', 'Common mistakes'] },
    { title: 'Summary', bullets: ['Three checks to remember', 'Short quiz next'] },
  ];
  const outline = (name) => ({
    sections: {
      learningObjectives: `By the end of “${name}” the learner can explain the method and apply it on site.`,
      keyConcepts: 'Definitions, the standard procedure, common failure modes.',
      activities: 'Worked example, then a short site scenario.',
    },
  });
  const script = (name) => ({
    blocks: [
      { id: 'b1', title: 'Opening', narration: `Welcome to ${name}. In the next few minutes we will look at why this matters on the plant floor.` },
      { id: 'b2', title: 'The method', narration: 'We start from the standard procedure and walk through each step with a real example.' },
      { id: 'b3', title: 'Wrap-up', narration: 'Before the quiz, remember the three checks we covered.' },
    ],
  });

  /**
   * Take one lesson's assets as far as `upTo` (an asset type) — each made by its
   * maker and approved by its reviewer — and submit the next one if asked.
   */
  async function produceLesson(course, lesson, { ai = false, upTo = 'VIDEO', submitNext = false, reviewerOverride = {} } = {}) {
    const detail = await lessons.getLesson(actor('viewer'), lesson.id);
    const byType = Object.fromEntries(detail.assets.map((entry) => [entry.assetType, entry]));
    const order = ['OUTLINE', 'PPT', 'SCRIPT', 'VOICE_OVER', 'VIDEO'].filter((type) => byType[type]?.applicable !== false && byType[type]);
    const stop = order.indexOf(upTo);
    for (const [index, type] of order.entries()) {
      if (index > stop + (submitNext ? 1 : 0)) break;
      const [maker, reviewer] = ASSET_PEOPLE[type];
      const decider = reviewerOverride[type] ?? reviewer;
      const assetId = byType[type].id;
      if (['APPROVED', 'LOCKED'].includes(byType[type].status)) continue;
      await assets.assign(actor('viewer'), assetId, { assigneeUserId: ids[maker], reviewerUserId: ids[decider] });
      const provenance = ai ? { aiAssisted: true, aiTool: type === 'PPT' ? 'Docki' : type === 'VIDEO' ? 'Think' : type === 'VOICE_OVER' ? 'TTS' : 'GPT' } : {};
      let versionId = null;
      if (type === 'OUTLINE' || type === 'SCRIPT') {
        await assets.saveDraft(actor(maker), assetId, { content: type === 'OUTLINE' ? outline(lesson.name) : script(lesson.name), revision: 0 });
        await assets.submit(actor(maker), assetId, provenance);
      } else {
        const upload =
          type === 'PPT'
            ? { bytes: slidesPdf({ title: `${course.code} · ${lesson.name}`, slides: deck(lesson.name) }), fileName: `${course.code}-deck.pdf` }
            : type === 'VOICE_OVER'
              ? { bytes: narrationWav({ seconds: 20, seed: lesson.name.length }), fileName: `${course.code}-vo.wav`, durationSeconds: 20 }
              : { externalUrl: `https://media.demo.qodo.invalid/${course.code.toLowerCase()}/${encodeURIComponent(lesson.name)}`, durationSeconds: 210 };
        const uploaded = await assets.uploadVersion(actor(maker), assetId, { ...upload, ...provenance });
        versionId = uploaded.currentVersion?.id ?? null;
        await assets.submit(actor(maker), assetId, {});
      }
      if (index > stop) break; // submitted, left for review
      if (type === 'VIDEO' && versionId) {
        const checklist = await tools.versionChecklist(actor(decider), versionId);
        for (const item of checklist.items) await tools.updateChecklistItem(actor(decider), item.id, { status: 'PASSED' });
      }
      await assets.approve(actor(decider), assetId, {});
    }
  }

  async function newRun(scenario, course, extra = {}) {
    const created = await runs.createRun(actor('viewer'), {
      scenario,
      course: { name: course.name, code: course.code, description: course.description },
      startDate: day(course.start),
      targetDate: day(course.target),
      team,
      ...extra,
    });
    touched.courses.push(created.course.id);
    touched.runs.push(created.run.id);
    // Marked at once, so a load that fails half-way is still removed by --reset.
    await query(`UPDATE ${S}.learning_courses SET is_demo = true WHERE id = $1`, [created.course.id]);
    return { runId: created.run.id, courseId: created.course.id, course };
  }

  /* ── 1. legacy runs for the blueprint courses ─────────────────── */

  await query(
    `INSERT INTO ${S}.learning_production_runs
       (organization_id, course_id, run_number, scenario, status, manager_user_id, start_date, target_date,
        is_legacy, is_demo, created_by, created_at)
     SELECT c.organization_id, c.id, 1, 'LEGACY', CASE WHEN c.status = 'ON_HOLD' THEN 'ON_HOLD' ELSE 'ACTIVE' END,
            c.manager_user_id, c.start_date, c.target_date, true, true, c.created_by, c.created_at
       FROM ${S}.learning_courses c
      WHERE c.organization_id = $1 AND c.is_demo
        AND NOT EXISTS (SELECT 1 FROM ${S}.learning_production_runs r WHERE r.course_id = c.id)`,
    [organizationId]
  );
  await query(
    `INSERT INTO ${S}.learning_activity_log (organization_id, course_id, run_id, actor_user_id, event_type, metadata_json, created_at)
     SELECT r.organization_id, r.course_id, r.id, NULL, 'RUN_CREATED', jsonb_build_object('scenario', 'LEGACY', 'backfill', true), r.created_at
       FROM ${S}.learning_production_runs r JOIN ${S}.learning_courses c ON c.id = r.course_id
      WHERE c.organization_id = $1 AND c.is_demo AND r.is_legacy`,
    [organizationId]
  );
  say('  Legacy runs for the imported courses.');

  const adoptable = await query(
    `SELECT r.id FROM ${S}.learning_production_runs r JOIN ${S}.learning_courses c ON c.id = r.course_id
      WHERE c.organization_id = $1 AND c.is_demo AND c.code = 'MECH-02' AND r.is_legacy AND r.status = 'ACTIVE'`,
    [organizationId]
  );
  if (adoptable.rows[0]) {
    await runs.adoptTemplate(actor('viewer'), adoptable.rows[0].id, { scenario: 'EXPERT_NEW' });
    say('  Mechanical Design Fundamentals adopted the expert-led workflow.');
  }

  /* ── 2. an expert-led program, research to published release ───── */

  const pumps = await newRun('EXPERT_NEW', {
    name: 'Pump and Seal Maintenance',
    code: 'PSM-10',
    description: 'Centrifugal pumps, mechanical seals and alignment for maintenance technicians.',
    start: -150,
    target: -12,
  });
  const pumpLessons = await createLessonsAfter(pumps, ['RESEARCH', 'CURRICULUM_DRAFT', 'EXPERT_ACQUISITION', 'FINAL_CURRICULUM', 'INSTRUCTIONAL_DESIGN'], 'Module 01 — Pumps', [
    'Centrifugal Pump Anatomy',
    'Mechanical Seal Types',
    'Shaft Alignment Basics',
  ]);
  for (const lesson of pumpLessons) await produceLesson(pumps.course, lesson);
  for (const key of ['PLATFORM_DEPLOYMENT', 'DRY_RUN_1', 'DRY_RUN_FIXES', 'REDEPLOYMENT', 'UAT']) await finishStage(pumps.runId, key);
  const prepared = await releases.prepareRelease(actor('viewer'), pumps.runId, { notes: 'First public cohort.' });
  await releases.signoffRelease(actor('hala'), prepared.release.id, { notes: 'Content and UAT checked.' });
  await releases.publishRelease(actor('viewer'), prepared.release.id, {
    platformUrl: 'https://lms.demo.qodo.invalid/programs/psm-10',
    deploymentNotes: 'Cloned from the dry-run copy; enrolment opened for the first cohort.',
  });
  say('  Pump and Seal Maintenance — released r1.0.0.');

  /* ── 3. its revamp, change impact waiting for approval ─────────── */

  const revamp = await runs.createRun(actor('viewer'), {
    scenario: 'REVAMP',
    courseId: pumps.courseId,
    sourceReleaseId: prepared.release.id,
    title: 'API 682 update',
    startDate: day(-5),
    targetDate: day(55),
    team,
  });
  touched.runs.push(revamp.run.id);
  await impact.saveImpact(actor('viewer'), revamp.run.id, {
    items: [
      { lessonId: pumpLessons[0].id, decision: 'KEEP' },
      { lessonId: pumpLessons[1].id, assetType: 'PPT', decision: 'CHANGE', note: 'New seal arrangement diagrams (API 682, 4th ed.)' },
      { lessonId: pumpLessons[1].id, assetType: 'SCRIPT', decision: 'CHANGE', note: 'Update the seal plan narration' },
      { lessonId: pumpLessons[2].id, decision: 'KEEP' },
    ],
  });
  await finishTask(await taskId(revamp.run.id, 'impact.review'), { submitOnly: true });
  say('  Pump and Seal Maintenance — revamp started, change impact waiting for approval.');

  /* ── 4. an expert-led program in its first weeks ───────────────── */

  const safety = await newRun('EXPERT_NEW', {
    name: 'Industrial Electrical Safety',
    code: 'IES-11',
    description: 'Arc flash, lockout/tagout and safe work on low-voltage systems.',
    start: -21,
    target: 80,
  });
  await finishStage(safety.runId, 'RESEARCH');
  for (const key of ['draft.structure', 'draft.fill', 'draft.fonts', 'draft.id_review']) await finishTask(await taskId(safety.runId, key));
  const apply = await taskId(safety.runId, 'draft.apply');
  {
    const detail = await tasks.getTask(actor('reem'), apply);
    for (const item of detail.checklist) await tasks.updateChecklistItem(actor('reem'), item.id, { status: 'DONE' });
    await tasks.addEvidence(actor('reem'), apply, { url: 'https://docs.demo.qodo.invalid/ies-11/draft-v1', note: 'First full draft' });
    await tasks.submitTask(actor('reem'), apply, { notes: 'Applied the ID comments.' });
    await tasks.requestTaskChanges(actor('nour'), apply, { notes: 'Module 3 objectives need measurable verbs; merge lessons 3.2 and 3.3.' });
    await tasks.addEvidence(actor('reem'), apply, { url: 'https://docs.demo.qodo.invalid/ies-11/draft-v2', note: 'Objectives rewritten, lessons merged' });
    await tasks.submitTask(actor('reem'), apply, {});
    await tasks.addTaskComment(actor('reem'), apply, { body: 'Merged 3.2 and 3.3 as asked — the module is now five lessons.' });
  }
  const candidates = [
    { fullName: 'م. وائل الحسيني', email: 'wael@example.com', source: 'LINKEDIN', yearsExperience: 14, status: 'TECHNICAL_DISCUSSION', assessment: { technical: 5, english: 4 } },
    { fullName: 'د. سمر القاضي', email: 'samar@example.com', source: 'REFERRAL', yearsExperience: 18, status: 'PASSED', assessment: { technical: 5, english: 5 } },
    { fullName: 'م. حسام طه', source: 'APOLLO', yearsExperience: 9, status: 'CONTACTED' },
    { fullName: 'م. رامي عيسى', source: 'LINKEDIN', yearsExperience: 6, status: 'REJECTED', notes: 'No arc-flash field experience.' },
  ];
  for (const candidate of candidates) await experts.createCandidate(actor('yasmin'), safety.runId, candidate);
  const listed = await experts.listCandidates(actor('yasmin'), safety.runId);
  const shortlisted = listed.candidates.find((entry) => entry.status === 'PASSED');
  await experts.addCandidateFile(actor('yasmin'), shortlisted.id, {
    bytes: slidesPdf({ title: 'Curriculum vitae', slides: [{ title: 'Experience', bullets: ['18 years in electrical safety', 'Arc-flash studies for 40+ plants'] }] }),
    fileName: 'cv.pdf',
    kind: 'CV',
  });
  const sourcing = await stageOf(safety.runId, 'EXPERT_ACQUISITION');
  const late = sourcing.tasks.filter((entry) => entry.classification === 'REQUIRED').slice(0, 2);
  for (const [index, entry] of late.entries()) await tasks.assignTask(actor('viewer'), entry.id, { dueDate: day(-3 - index * 4) });
  say('  Industrial Electrical Safety — draft resubmitted, four expert candidates, two late tasks.');

  /* ── 5. an AI-assisted program, outlines waiting for you ───────── */

  const lean = await newRun('AI_NEW', {
    name: 'Lean Six Sigma Yellow Belt',
    code: 'LSS-12',
    description: 'DMAIC, waste and basic statistics for front-line teams.',
    start: -14,
    target: 45,
  });
  await finishStage(lean.runId, 'AI_INPUT');
  const leanLessons = await createLessons(lean.courseId, 'Module 01 — Foundations', [
    'What is Lean?',
    'The Eight Wastes',
    'DMAIC at a Glance',
    'Reading a Control Chart',
  ]);
  await finishTask(await taskId(lean.runId, 'ai.outlines.generate'));
  for (const [index, lesson] of leanLessons.entries()) {
    if (index < 2) await produceLesson(lean.course, lesson, { ai: true, upTo: 'OUTLINE' });
    else await produceLesson(lean.course, lesson, { ai: true, upTo: 'NONE', submitNext: true, reviewerOverride: { OUTLINE: 'viewer' } });
  }
  say('  Lean Six Sigma Yellow Belt — AI outlines, two waiting for your review.');

  /* ── 6. a program in its dry-run fixes ─────────────────────────── */

  const compressors = await newRun('EXPERT_NEW', {
    name: 'Compressor Operations',
    code: 'CMP-13',
    description: 'Reciprocating and screw compressors: operation, surge and routine checks.',
    start: -95,
    target: 12,
  });
  const compressorLessons = await createLessonsAfter(compressors, ['RESEARCH', 'CURRICULUM_DRAFT', 'EXPERT_ACQUISITION', 'FINAL_CURRICULUM', 'INSTRUCTIONAL_DESIGN'], 'Module 01 — Operation', [
    'Compressor Types',
    'Surge and Stonewall',
  ]);
  for (const lesson of compressorLessons) await produceLesson(compressors.course, lesson);
  await finishStage(compressors.runId, 'PLATFORM_DEPLOYMENT');
  const dryContent = await taskId(compressors.runId, 'dry.content');
  await finishTask(await taskId(compressors.runId, 'dry.freeze'));
  await finishTask(await taskId(compressors.runId, 'dry.landing'));
  {
    const detail = await tasks.getTask(actor('viewer'), dryContent);
    const lines = detail.checklist.filter((item) => item.status === 'PENDING');
    const found = [
      { title: 'Surge video has no audio after 02:10', severity: 'HIGH', area: 'MEDIA', owner: 'youssef' },
      { title: 'Quiz 1 accepts an empty answer', severity: 'MEDIUM', area: 'PLATFORM', owner: 'ali' },
      { title: 'Typo in the lesson 1 title slide', severity: 'LOW', area: 'CONTENT', owner: 'ahmed' },
    ];
    for (const [index, issue] of found.entries()) {
      await tasks.updateChecklistItem(actor('viewer'), lines[index].id, {
        status: 'ISSUE',
        comment: issue.title,
        issue: { title: issue.title, severity: issue.severity, area: issue.area, ownerUserId: ids[issue.owner] },
      });
    }
    for (const item of lines.slice(found.length)) await tasks.updateChecklistItem(actor('viewer'), item.id, { status: 'DONE' });
    await tasks.completeTask(actor('viewer'), dryContent, {});
  }
  await finishTask(await taskId(compressors.runId, 'dry.report'));
  await finishTask(await taskId(compressors.runId, 'fix.triage'));
  const logged = (await issues.listIssues(actor('viewer'), compressors.runId)).issues;
  const byTitle = (start) => logged.find((issue) => issue.title.startsWith(start));
  await issues.transitionIssue(actor('ahmed'), byTitle('Typo').id, 'fix', { note: 'Title slide corrected and re-exported.' });
  await issues.transitionIssue(actor('viewer'), byTitle('Typo').id, 'verify', { note: 'Checked on the dry-run copy.' });
  await issues.transitionIssue(actor('ali'), byTitle('Quiz').id, 'start', {});
  await issues.transitionIssue(actor('ali'), byTitle('Quiz').id, 'fix', { note: 'Required-answer rule switched on for every question.' });
  say('  Compressor Operations — dry-run fixes: one verified, one to verify, one high issue open.');

  /* ── 7. a program on hold ──────────────────────────────────────── */

  const writing = await newRun('AI_NEW', {
    name: 'Technical Report Writing',
    code: 'TRW-14',
    description: 'Structuring and writing inspection and incident reports.',
    start: -30,
    target: 60,
  });
  await finishStage(writing.runId, 'AI_INPUT');
  await runs.updateRun(actor('viewer'), writing.runId, { status: 'ON_HOLD', reason: 'Waiting for the client to confirm the report templates.' });
  say('  Technical Report Writing — on hold.');

  /* ── marking and clean-up ──────────────────────────────────────── */

  await query(`UPDATE ${S}.learning_courses SET is_demo = true WHERE id = ANY($1::uuid[])`, [touched.courses]);
  await query(`UPDATE ${S}.learning_production_runs SET is_demo = true WHERE course_id IN (SELECT id FROM ${S}.learning_courses WHERE organization_id = $1 AND is_demo)`, [organizationId]);
  await query(`DELETE FROM ${S}.learning_notification_preferences WHERE user_id = ANY($1::text[])`, [people]);
  for (const row of saved.rows) {
    await query(
      `INSERT INTO ${S}.learning_notification_preferences (user_id, organization_id, muted_events, due_soon_days, overdue_repeat_days, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.user_id, row.organization_id, row.muted_events, row.due_soon_days, row.overdue_repeat_days, row.updated_at]
    );
  }

  return touched;

  /** Walk a run through its program stages, then add lessons for media production. */
  async function createLessonsAfter(target, stageKeys, moduleName, names) {
    for (const key of stageKeys) await finishStage(target.runId, key);
    return createLessons(target.courseId, moduleName, names);
  }
}
