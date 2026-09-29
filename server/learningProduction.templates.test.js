/**
 * E-Learning Production — workflow templates and run rules, without a database.
 *
 * The workbook trace (every populated row, visible or hidden, is either cited
 * by a template or explicitly classified), the three scenarios' stage orders,
 * the task transitions and who may take them, the automatic gates, the
 * progress split and the reminder cadence. The database-backed run
 * guarantees are in learningProduction.runs.test.js.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DETAIL_SHEETS, MASTER_ACTIVITIES } from '../shared/learningProduction/workbookSource.js';
import { ANOMALIES, OPEN_DECISIONS, traceRows } from '../shared/learningProduction/traceability.js';
import {
  SCENARIOS,
  TEMPLATE_OPTIONS,
  buildTemplate,
  defaultOptions,
  validateTemplate,
} from '../shared/learningProduction/workflowTemplates.js';
import {
  TASK_LEGAL_FROM,
  computeRun,
  evaluateRule,
  evaluateTask,
  isTaskGating,
  nextReleaseLabel,
  nextTaskStatus,
  primaryTaskAction,
  runHealth,
  runProgress,
  taskDueState,
} from '../shared/learningProduction/runs.js';
import { STAGE_KEYS } from '../shared/learningProduction/constants.js';
import { LP_PERMISSIONS as P, buildGrants } from '../shared/learningProduction/permissions.js';
import { deadlineKey } from './learningProduction/clock.js';

const everyOption = Object.fromEntries(Object.keys(TEMPLATE_OPTIONS).map((key) => [key, true]));
const noOption = Object.fromEntries(Object.keys(TEMPLATE_OPTIONS).map((key) => [key, false]));
const stageKeys = (template) => template.stages.map((stage) => stage.key);

/* ------------------------------------------------------------------ */
/* The workbook trace                                                   */
/* ------------------------------------------------------------------ */

describe('the workbook becomes the workflow, row by row', () => {
  test('every populated row, visible or hidden, is cited or classified — none is dropped', () => {
    const { detail, master } = traceRows();
    const populated = DETAIL_SHEETS.reduce((sum, sheet) => sum + sheet.rows.length, 0);
    assert.equal(detail.length, populated);
    assert.equal(master.length, MASTER_ACTIVITIES.length);
    const untraced = [...detail, ...master].filter((row) => row.status === 'UNTRACED');
    assert.deepEqual(untraced, [], `untraced rows: ${untraced.map((row) => `${row.sheet ?? 'master'} r${row.row}`).join(', ')}`);
  });

  test('all 44 hidden rows are accounted for, and each is marked hidden wherever it is used', () => {
    const { detail } = traceRows();
    const hidden = detail.filter((row) => row.hidden);
    assert.equal(hidden.length, 44);
    for (const scenario of SCENARIOS) {
      for (const stage of buildTemplate(scenario, everyOption).stages) {
        for (const task of stage.tasks) {
          for (const line of task.checklist) {
            if (!line.source?.sheet) continue;
            const row = DETAIL_SHEETS.find((sheet) => sheet.name === line.source.sheet)?.rows.find((entry) => entry.row === line.source.rows[0]);
            if (row?.hidden) assert.equal(line.origin, 'WORKBOOK_HIDDEN', `${task.key}/${line.key}`);
          }
        }
      }
    }
  });

  test('the hidden duplicate of the deployment review is classified, not reused', () => {
    const { detail } = traceRows();
    const duplicate = detail.filter((row) => row.sheet === 'Platform Deployment' && row.row >= 12 && row.row <= 16);
    assert.ok(duplicate.every((row) => row.status === 'DUPLICATE'));
  });

  test('FALSE checkbox cells are recorded, never read as status', () => {
    const cells = DETAIL_SHEETS.flatMap((sheet) => sheet.rows).filter((row) => row.checkboxCell);
    assert.equal(cells.length, 35);
    for (const scenario of SCENARIOS) {
      for (const stage of buildTemplate(scenario, everyOption).stages) {
        for (const task of stage.tasks) assert.ok(task.checklist.every((line) => !('status' in line)), 'template lines carry no status');
      }
    }
  });

  test('the master sheet row labelled "1st Draft Curriculum" with ID new_first_run_8 is the first dry run', () => {
    const row = MASTER_ACTIVITIES.find((entry) => entry.path === 'NEW_PROGRAM' && entry.row === 9);
    assert.equal(row.label, '1st Draft Curriculum');
    assert.equal(row.activityId, 'new_first_run_8');
    const stage = buildTemplate('EXPERT_NEW').stages.find((entry) => entry.source?.row === 9 && entry.source?.path === 'NEW_PROGRAM');
    assert.equal(stage.key, 'DRY_RUN_1');
    assert.ok(ANOMALIES.some((entry) => entry.id === 'master-row9-label'));
  });

  test('headings become tasks or groups, never finished work', () => {
    const research = buildTemplate('EXPERT_NEW').stages.find((stage) => stage.key === 'RESEARCH');
    const analysis = research.tasks.find((task) => task.key === 'research.analysis');
    assert.deepEqual(analysis.source.rows, [13, 14, 18, 21]);
    assert.ok(analysis.checklist.every((line) => line.group), 'sub-headings are groups');
  });

  test('open decisions that affect release are listed for the owner', () => {
    assert.ok(OPEN_DECISIONS.filter((entry) => entry.affectsRelease).length >= 5);
    assert.ok(OPEN_DECISIONS.every((entry) => entry.question && entry.default));
  });
});

/* ------------------------------------------------------------------ */
/* The three scenarios                                                  */
/* ------------------------------------------------------------------ */

describe('templates', () => {
  test('every scenario, with every combination of options, builds a sound template', () => {
    for (const scenario of SCENARIOS) {
      for (const options of [{}, everyOption, noOption]) {
        const template = buildTemplate(scenario, options);
        assert.deepEqual(validateTemplate(template), [], `${scenario} ${JSON.stringify(options)}`);
        for (const stage of template.stages) assert.ok(STAGE_KEYS.includes(stage.key), `${stage.key} is a known stage key`);
      }
    }
  });

  test('B1 — an expert-led new program follows the master sequence', () => {
    assert.deepEqual(stageKeys(buildTemplate('EXPERT_NEW')), [
      'RESEARCH',
      'CURRICULUM_DRAFT',
      'EXPERT_ACQUISITION',
      'FINAL_CURRICULUM',
      'INSTRUCTIONAL_DESIGN',
      'MEDIA_PRODUCTION',
      'PLATFORM_DEPLOYMENT',
      'DRY_RUN_1',
      'DRY_RUN_FIXES',
      'REDEPLOYMENT',
      'UAT',
      'RELEASE',
    ]);
    const template = buildTemplate('EXPERT_NEW');
    const byKey = Object.fromEntries(template.stages.map((stage) => [stage.key, stage]));
    assert.deepEqual(byKey.EXPERT_ACQUISITION.after, ['RESEARCH'], 'expert sourcing overlaps the first draft');
    assert.deepEqual(byKey.CURRICULUM_DRAFT.after, ['RESEARCH']);
    assert.ok(byKey.EXPERT_ACQUISITION.skippable, 'skippable when an expert is contracted');
    assert.ok(byKey.EXPERT_ACQUISITION.tasks.find((task) => task.key === 'experts.contract').sensitive);
    const final = byKey.FINAL_CURRICULUM.tasks.map((task) => task.key);
    for (const key of ['final.mcqs', 'final.tasks', 'final.projects']) assert.ok(final.includes(key), `${key} is an explicit deliverable`);
    assert.ok(byKey.FINAL_CURRICULUM.tasks.find((task) => task.key === 'final.mcqs').checklist.every((line) => line.origin === 'PROPOSED'));
    assert.equal(byKey.REDEPLOYMENT.tasks[0].origin, 'PROPOSED', 'the empty redeployment sheet gives a proposed checklist');
  });

  test('A — the AI path follows its sequence, then the proposed release gates', () => {
    assert.deepEqual(stageKeys(buildTemplate('AI_NEW')), [
      'AI_INPUT',
      'AI_OUTLINES',
      'AI_OUTLINE_REVIEW',
      'FINAL_CURRICULUM',
      'AI_SCRIPTS',
      'AI_SCRIPT_REVIEW',
      'AI_SLIDES',
      'AI_VOICE_VIDEO',
      'AI_VIDEO_REVIEW',
      'AI_COMMENTS_FIX',
      'AI_COMMENTS_VERIFY',
      'PLATFORM_DEPLOYMENT',
      'UAT',
      'RELEASE',
    ]);
    const gated = buildTemplate('AI_NEW');
    for (const key of ['PLATFORM_DEPLOYMENT', 'UAT', 'RELEASE']) {
      assert.equal(gated.stages.find((stage) => stage.key === key).origin, 'PROPOSED', `${key} is labelled a proposal`);
    }
    assert.ok(!stageKeys(buildTemplate('AI_NEW', { aiReleaseGates: false })).includes('UAT'), 'an administrator can switch the gates off');
    assert.ok(stageKeys(buildTemplate('AI_NEW', { aiDryRun: true })).includes('DRY_RUN_1'));
    const handoffs = gated.stages.flatMap((stage) => stage.tasks).filter((task) => task.externalTool);
    assert.deepEqual(handoffs.map((task) => task.externalTool).sort(), ['Docki', 'Think']);
    assert.ok(handoffs.every((task) => task.requiresEvidence && task.kind === 'HANDOFF'), 'handoffs are manual, with evidence');
  });

  test('B2 — a revamp follows its sequence, keeping stages 5 and 6 distinct', () => {
    assert.deepEqual(stageKeys(buildTemplate('REVAMP')), [
      'CHANGE_IMPACT',
      'INSTRUCTIONAL_DESIGN',
      'MEDIA_PRODUCTION',
      'PLATFORM_DEPLOYMENT',
      'DRY_RUN_1',
      'APPLY_CHANGES',
      'APPLY_DRY_RUN_COMMENTS',
      'DRY_RUN_2',
      'UAT',
      'RELEASE',
    ]);
    const revamp = buildTemplate('REVAMP');
    const deploy = revamp.stages.find((stage) => stage.key === 'PLATFORM_DEPLOYMENT').tasks.map((task) => task.key);
    assert.ok(deploy.includes('deploy.clone'), 'revamps clone from the latest release (hidden rows 17–20)');
    assert.ok(!buildTemplate('EXPERT_NEW').stages.find((stage) => stage.key === 'PLATFORM_DEPLOYMENT').tasks.some((task) => task.key === 'deploy.clone'));
    assert.equal(revamp.stages.find((stage) => stage.key === 'APPLY_CHANGES').tasks[0].classification, 'CONDITIONAL');
    assert.ok(!stageKeys(buildTemplate('REVAMP', { changeImpact: false })).includes('CHANGE_IMPACT'));
  });

  test('default options are the documented defaults', () => {
    assert.deepEqual(defaultOptions('AI_NEW'), { deployHiddenChecklist: true, aiReleaseGates: true, aiDryRun: false });
    assert.deepEqual(defaultOptions('EXPERT_NEW'), { idHiddenChecklist: true, deployHiddenChecklist: true });
  });
});

/* ------------------------------------------------------------------ */
/* Task rules                                                           */
/* ------------------------------------------------------------------ */

const manager = buildGrants({ roles: ['PRODUCTION_MANAGER'] });
const nobody = buildGrants({});
const admin = buildGrants({ orgPermissions: [P.ADMIN] });

function task(overrides = {}) {
  return {
    id: 't1',
    key: 'draft.apply',
    stageKey: 'CURRICULUM_DRAFT',
    kind: 'WORK',
    classification: 'REQUIRED',
    role: 'RESEARCHER',
    reviewerRole: 'INSTRUCTIONAL_DESIGNER',
    requiresApproval: true,
    requiresEvidence: true,
    status: 'IN_PROGRESS',
    assigneeUserId: 'maker',
    reviewerUserId: 'checker',
    submittedBy: null,
    dependencyOverrideAt: null,
    ...overrides,
  };
}

describe('task transitions', () => {
  test('named steps only, from the states they start from', () => {
    assert.equal(nextTaskStatus('START', 'NOT_STARTED'), 'IN_PROGRESS');
    assert.equal(nextTaskStatus('SUBMIT', 'IN_PROGRESS'), 'SUBMITTED');
    assert.equal(nextTaskStatus('START_REVIEW', 'SUBMITTED'), 'UNDER_REVIEW');
    assert.equal(nextTaskStatus('REQUEST_CHANGES', 'UNDER_REVIEW'), 'CHANGES_REQUESTED');
    assert.equal(nextTaskStatus('SUBMIT', 'CHANGES_REQUESTED'), 'SUBMITTED');
    assert.equal(nextTaskStatus('APPROVE', 'SUBMITTED'), 'APPROVED');
    assert.equal(nextTaskStatus('COMPLETE', 'IN_PROGRESS'), 'DONE');
    assert.equal(nextTaskStatus('WAIVE', 'NOT_STARTED'), 'WAIVED');
    assert.equal(nextTaskStatus('REOPEN', 'APPROVED'), 'IN_PROGRESS');
    assert.equal(nextTaskStatus('APPROVE', 'IN_PROGRESS'), null);
    assert.equal(nextTaskStatus('COMPLETE', 'NOT_STARTED'), null);
    assert.ok(!TASK_LEGAL_FROM.REOPEN.includes('IN_PROGRESS'));
  });

  test('the maker works and submits by name or by role; nobody approves their own', () => {
    const base = { grants: nobody, checklist: [{ required: true, status: 'DONE' }], evidenceCount: 1 };
    const maker = evaluateTask({ ...base, task: task(), userId: 'maker' });
    assert.equal(maker.actions.SUBMIT.allowed, true);
    const byRole = evaluateTask({ ...base, task: task({ assigneeUserId: null }), userId: 'someone', roles: ['RESEARCHER'] });
    assert.equal(byRole.actions.SUBMIT.allowed, true, 'holding the named role is enough for one task');
    const stranger = evaluateTask({ ...base, task: task(), userId: 'stranger', roles: ['VIEWER'] });
    assert.equal(stranger.actions.SUBMIT.reason, 'FORBIDDEN');

    const submitted = task({ status: 'SUBMITTED', submittedBy: 'maker' });
    assert.equal(evaluateTask({ ...base, task: submitted, userId: 'checker' }).actions.APPROVE.allowed, true);
    assert.equal(evaluateTask({ ...base, task: submitted, grants: manager, userId: 'maker' }).actions.APPROVE.reason, 'OWN_WORK');
    const adminOwn = evaluateTask({ ...base, task: submitted, grants: admin, userId: 'maker' });
    assert.equal(adminOwn.actions.APPROVE.allowed, true);
    assert.equal(adminOwn.approvalNeedsOverride, true, 'an administrator approving their own work must give a reason');
  });

  test('a submission needs its required lines addressed and its evidence', () => {
    const pending = evaluateTask({ task: task(), grants: nobody, userId: 'maker', checklist: [{ required: true, status: 'PENDING' }], evidenceCount: 1 });
    assert.equal(pending.actions.SUBMIT.reason, 'CHECKLIST_INCOMPLETE');
    const optional = evaluateTask({ task: task(), grants: nobody, userId: 'maker', checklist: [{ required: false, status: 'PENDING' }], evidenceCount: 1 });
    assert.equal(optional.actions.SUBMIT.allowed, true, 'optional lines never hold a task');
    const noEvidence = evaluateTask({ task: task(), grants: nobody, userId: 'maker', checklist: [], evidenceCount: 0 });
    assert.equal(noEvidence.actions.SUBMIT.reason, 'EVIDENCE_REQUIRED');
    const resubmit = evaluateTask({ task: task({ status: 'CHANGES_REQUESTED' }), grants: nobody, userId: 'maker', evidenceCount: 2, evidenceSinceDecision: 0 });
    assert.equal(resubmit.actions.SUBMIT.reason, 'NEW_EVIDENCE_REQUIRED', 'sent back means something new has to come back');
    const needsApproval = evaluateTask({ task: task(), grants: nobody, userId: 'maker', evidenceCount: 1 });
    assert.equal(needsApproval.actions.COMPLETE.reason, 'APPROVAL_REQUIRED');
    assert.equal(primaryTaskAction(pending, task()).disabledReason, 'CHECKLIST_INCOMPLETE');
  });

  test('conditional tasks are waived with authority; required ones only by an administrator', () => {
    const conditional = task({ classification: 'CONDITIONAL', status: 'NOT_STARTED' });
    assert.equal(evaluateTask({ task: conditional, grants: manager, userId: 'boss' }).actions.WAIVE.allowed, true);
    assert.equal(evaluateTask({ task: conditional, grants: nobody, userId: 'maker' }).actions.WAIVE.reason, 'FORBIDDEN');
    const required = task({ status: 'NOT_STARTED' });
    assert.equal(evaluateTask({ task: required, grants: manager, userId: 'boss' }).actions.WAIVE.reason, 'REQUIRED_TASK');
    assert.equal(evaluateTask({ task: required, grants: admin, userId: 'root' }).actions.WAIVE.allowed, true);
  });

  test('blocked work cannot start until its prerequisites finish or a manager overrides', () => {
    const blockers = [{ type: 'STAGE', key: 'RESEARCH', status: 'IN_PROGRESS' }];
    const blocked = evaluateTask({ task: task({ status: 'NOT_STARTED' }), grants: nobody, userId: 'maker', blockers });
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.actions.START.reason, 'TASK_BLOCKED');
    assert.equal(blocked.actions.OVERRIDE_DEPENDENCY.reason, 'FORBIDDEN');
    assert.equal(evaluateTask({ task: task({ status: 'NOT_STARTED' }), grants: manager, userId: 'boss', blockers }).actions.OVERRIDE_DEPENDENCY.allowed, true);
    const overridden = evaluateTask({ task: task({ status: 'NOT_STARTED', dependencyOverrideAt: '2026-01-01' }), grants: nobody, userId: 'maker', blockers });
    assert.equal(overridden.actions.START.allowed, true);
  });

  test('closed runs, skipped stages and automatic gates take no manual action', () => {
    assert.equal(evaluateTask({ task: task(), grants: manager, userId: 'boss', runOpen: false }).actions.SUBMIT.reason, 'RUN_CLOSED');
    assert.equal(evaluateTask({ task: task(), grants: manager, userId: 'boss', stageSkipped: true }).actions.SUBMIT.reason, 'STAGE_SKIPPED');
    assert.equal(evaluateTask({ task: task({ kind: 'AUTO' }), grants: admin, userId: 'root' }).actions.COMPLETE.reason, 'AUTOMATIC');
  });
});

/* ------------------------------------------------------------------ */
/* Gates, stages and progress                                           */
/* ------------------------------------------------------------------ */

const assetFacts = (overrides = {}) => ({
  assets: {
    OUTLINE: { total: 2, approved: 2, submitted: 2, reviewed: 2, changesRequested: 0, openComments: 0 },
    PPT: { total: 2, approved: 1, submitted: 2, reviewed: 2, changesRequested: 1, openComments: 3 },
    SCRIPT: { total: 2, approved: 2, submitted: 2, reviewed: 2, changesRequested: 0, openComments: 0 },
    VOICE_OVER: { total: 0, approved: 0, submitted: 0, reviewed: 0, changesRequested: 0, openComments: 0 },
    VIDEO: { total: 2, approved: 0, submitted: 1, reviewed: 1, changesRequested: 0, openComments: 0 },
    ...overrides,
  },
  issues: { DRY_RUN_1: { open: 1, total: 3 } },
});

describe('automatic gates', () => {
  test('each rule reads the facts, and says how far along it is', () => {
    const facts = assetFacts();
    assert.equal(evaluateRule({ type: 'ASSETS_APPROVED', assetTypes: ['OUTLINE'] }, facts).satisfied, true);
    assert.deepEqual(evaluateRule({ type: 'ASSETS_APPROVED', assetTypes: ['PPT'] }, facts), { satisfied: false, done: 1, total: 2 });
    assert.equal(evaluateRule({ type: 'ASSETS_APPROVED', assetTypes: ['VOICE_OVER'] }, facts).satisfied, false, 'nothing to approve is not approval');
    assert.equal(evaluateRule({ type: 'ASSETS_SUBMITTED', assetTypes: ['VIDEO'] }, facts).satisfied, false);
    assert.equal(evaluateRule({ type: 'ASSET_FEEDBACK_ADDRESSED', assetTypes: ['PPT'] }, facts).satisfied, false);
    assert.equal(evaluateRule({ type: 'ISSUES_RESOLVED', stages: ['DRY_RUN_1'] }, facts).satisfied, false);
    assert.equal(evaluateRule({ type: 'ISSUES_RESOLVED', stages: ['UAT'] }, facts).satisfied, true);
    assert.equal(evaluateRule({ type: 'RELEASE_PUBLISHED' }, { releasePublished: true }).satisfied, true);
  });

  test('an automatic gate is not satisfied while it is still waiting for its stage to begin', () => {
    const stages = [
      { id: 's1', key: 'DRY_RUN_1', after: [], status: 'IN_PROGRESS' },
      { id: 's2', key: 'DRY_RUN_FIXES', after: ['DRY_RUN_1'], status: 'BLOCKED' },
    ];
    const tasks = [
      { id: 't1', key: 'dry.report', stageKey: 'DRY_RUN_1', kind: 'WORK', classification: 'REQUIRED', status: 'IN_PROGRESS', after: [] },
      { id: 't2', key: 'fix.gate', stageKey: 'DRY_RUN_FIXES', kind: 'AUTO', classification: 'REQUIRED', status: 'NOT_STARTED', after: [], rule: { type: 'ISSUES_RESOLVED', stages: ['DRY_RUN_1'] } },
    ];
    const early = computeRun({ stages, tasks, facts: { issues: {} } });
    assert.equal(early.tasks.find((entry) => entry.key === 'fix.gate').status, 'NOT_STARTED', 'no issues yet is not "every issue fixed"');
    assert.equal(early.stages[1].status, 'BLOCKED');

    const later = computeRun({ stages, tasks: [{ ...tasks[0], status: 'DONE' }, tasks[1]], facts: { issues: {} } });
    assert.equal(later.stages[0].status, 'DONE');
    assert.equal(later.tasks.find((entry) => entry.key === 'fix.gate').status, 'DONE');
    assert.equal(later.stages[1].status, 'DONE');
    assert.deepEqual(later.changes.stages.map((change) => [change.key, change.to]), [['DRY_RUN_1', 'DONE'], ['DRY_RUN_FIXES', 'DONE']]);
  });

  test('a waived conditional task leaves the count; an optional one never entered it', () => {
    assert.equal(isTaskGating({ classification: 'OPTIONAL', status: 'NOT_STARTED' }), false);
    assert.equal(isTaskGating({ classification: 'CONDITIONAL', status: 'WAIVED' }), false);
    assert.equal(isTaskGating({ classification: 'CONDITIONAL', status: 'NOT_STARTED' }), true);
    const stages = [{ id: 's', key: 'APPLY_CHANGES', after: [], status: 'READY' }];
    const waived = computeRun({ stages, tasks: [{ id: 't', key: 'change.apply', stageKey: 'APPLY_CHANGES', kind: 'WORK', classification: 'CONDITIONAL', status: 'WAIVED', after: [] }] });
    assert.equal(waived.stages[0].status, 'DONE');
  });
});

describe('progress is four answers, never one blended number', () => {
  test('every lesson asset approved moves content to 100% and nothing else', () => {
    const stages = [
      { key: 'MEDIA_PRODUCTION', status: 'DONE' },
      { key: 'PLATFORM_DEPLOYMENT', status: 'IN_PROGRESS' },
      { key: 'UAT', status: 'BLOCKED' },
      { key: 'RELEASE', status: 'BLOCKED' },
    ];
    const tasks = [
      { key: 'media.assets', stageKey: 'MEDIA_PRODUCTION', classification: 'REQUIRED', status: 'DONE' },
      { key: 'deploy.verify', stageKey: 'PLATFORM_DEPLOYMENT', classification: 'REQUIRED', status: 'IN_PROGRESS' },
      { key: 'uat.signoff', stageKey: 'UAT', classification: 'REQUIRED', status: 'NOT_STARTED' },
      { key: 'release.published', stageKey: 'RELEASE', classification: 'REQUIRED', status: 'NOT_STARTED' },
    ];
    const facts = { assets: { OUTLINE: { total: 3, approved: 3 } } };
    const progress = runProgress({ stages, tasks, facts, lessonAssetTypes: ['OUTLINE'] });
    assert.equal(progress.content.percent, 100);
    assert.equal(progress.workflow.percent, 25);
    assert.equal(progress.readiness.readyForSignoff, false);
    assert.deepEqual(progress.readiness.checks.find((check) => check.id === 'STAGES_COMPLETE').open, ['PLATFORM_DEPLOYMENT', 'UAT']);
    assert.equal(progress.published, null);
  });

  test('a legacy run is not assessed for release — nothing is inferred from its assets', () => {
    const progress = runProgress({ stages: [], tasks: [], facts: { assets: { OUTLINE: { total: 5, approved: 5 } } }, lessonAssetTypes: ['OUTLINE'], scenario: 'LEGACY' });
    assert.equal(progress.readiness.assessed, false);
    assert.equal(progress.readiness.readyToPublish, false);
    assert.equal(progress.content.percent, 100);
  });

  test('run health uses workflow progress and deadlines', () => {
    const settings = { delayedOverdueShare: 0.1, atRiskProgressGap: 15, atRiskDaysBeforeTarget: 7 };
    assert.equal(runHealth({ status: 'ACTIVE', workflowPercent: 50, targetDate: '2026-01-01', today: '2026-02-01', settings }).health, 'DELAYED');
    assert.equal(runHealth({ status: 'RELEASED', settings }).health, 'COMPLETED');
    assert.equal(runHealth({ status: 'ACTIVE', workflowPercent: 5, startDate: '2026-01-01', targetDate: '2026-12-31', today: '2026-07-01', settings }).health, 'AT_RISK');
  });
});

describe('dates and labels', () => {
  test('finished and waived tasks are never late', () => {
    assert.equal(taskDueState('2026-01-01', 'DONE', '2026-02-01'), null);
    assert.equal(taskDueState('2026-01-01', 'WAIVED', '2026-02-01'), null);
    assert.equal(taskDueState('2026-01-01', 'IN_PROGRESS', '2026-02-01'), 'OVERDUE');
  });

  test('reminder cadence follows the person\'s preferences, and a restart never repeats one', () => {
    const due = (dueDate, day, prefs) => deadlineKey({ id: 'x', dueDate, day, prefs, prefix: 'task-' });
    assert.equal(due('2026-03-10', '2026-03-01', { dueSoonDays: 2 }), null);
    assert.deepEqual(due('2026-03-10', '2026-03-09', { dueSoonDays: 2 }), { overdue: false, key: 'task-due-soon:x:2026-03-10' });
    assert.equal(due('2026-03-10', '2026-03-09', { dueSoonDays: 0 }), null, 'zero switches due-soon off');
    const day1 = due('2026-03-10', '2026-03-11', { overdueRepeatDays: 3 });
    const day3 = due('2026-03-10', '2026-03-13', { overdueRepeatDays: 3 });
    const day4 = due('2026-03-10', '2026-03-14', { overdueRepeatDays: 3 });
    assert.equal(day1.key, day3.key, 'within one period, one reminder');
    assert.notEqual(day3.key, day4.key, 'the next period reminds again');
    assert.equal(due('2026-03-10', '2026-05-01', { overdueRepeatDays: 0 }).key, due('2026-03-10', '2026-03-11', { overdueRepeatDays: 0 }).key, 'zero means once');
  });

  test('release labels count up; a revamp is a major release', () => {
    assert.equal(nextReleaseLabel(null), 'r1.0.0');
    assert.equal(nextReleaseLabel('r1.0.0'), 'r1.1.0');
    assert.equal(nextReleaseLabel('r1.2.0', { major: true }), 'r2.0.0');
  });
});
