import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRANSITIONS, approvalTimeline, transitionFor } from '../shared/recruitment/workflow.js';
import { capacityCheck, capacityLevel, loadByRecruiter } from '../shared/recruitment/capacity.js';
import { classificationFromTitle, locationCode } from '../shared/recruitment/classification.js';
import { DEFAULT_HR_SETTINGS, recruitmentPolicy, resolveHRSettings, validateHRSettings } from '../shared/recruitment/settings.js';
import { arabicWorkingDays, deriveRecruitmentAlerts } from '../shared/recruitment/alerts.js';
import { ALL_PERMISSIONS, PERMISSIONS, ROLES, can, permissionsFor } from '../shared/permissions.js';

/* ── Workflow ──────────────────────────────────────────────────── */

test('the request path is request → department review → final approval → hiring', () => {
  assert.deepEqual(transitionFor('draft', 'submit'), { ok: true, to: 'pending_review', stage: 'request', decision: 'submitted' });
  assert.equal(transitionFor('pending_review', 'review_approve').to, 'pending_approval');
  assert.equal(transitionFor('pending_approval', 'approve').to, 'hiring');
  assert.equal(transitionFor('hiring', 'complete').to, 'completed');
});

test('hold, resume and cancel are only reachable from their own states', () => {
  assert.equal(transitionFor('hiring', 'hold').to, 'on_hold');
  assert.equal(transitionFor('on_hold', 'resume').to, 'hiring');
  for (const status of ['draft', 'pending_review', 'pending_approval', 'hiring', 'on_hold']) {
    assert.equal(transitionFor(status, 'cancel').to, 'cancelled', status);
  }
});

test('every skipped or backwards step is refused', () => {
  const refused = [
    ['draft', 'approve'],
    ['draft', 'review_approve'],
    ['pending_review', 'approve'],
    ['pending_approval', 'review_approve'],
    ['hiring', 'approve'],
    ['completed', 'cancel'],
    ['cancelled', 'resume'],
    ['rejected', 'submit'],
    ['on_hold', 'complete'],
    ['pending_review', 'hold'],
  ];
  for (const [status, action] of refused) {
    assert.equal(transitionFor(status, action).ok, false, `${status} → ${action}`);
    assert.equal(transitionFor(status, action).error, 'recruitment_transition_invalid');
  }
  assert.equal(transitionFor('draft', 'teleport').error, 'recruitment_action_unknown');
});

test('only final approval starts hiring — no other transition lands on it except resume', () => {
  const into = Object.entries(TRANSITIONS).filter(([, rule]) => rule.to === 'hiring').map(([action]) => action).sort();
  assert.deepEqual(into, ['approve', 'resume']);
});

test('the approval timeline shows the latest decision at each step', () => {
  const steps = approvalTimeline({ status: 'pending_approval' }, [
    { stage: 'request', decision: 'submitted', createdAt: '2026-09-21T10:20:00Z' },
    { stage: 'department_review', decision: 'returned', createdAt: '2026-09-21T12:00:00Z' },
    { stage: 'request', decision: 'submitted', createdAt: '2026-09-21T13:00:00Z' },
    { stage: 'department_review', decision: 'approved', createdAt: '2026-09-21T15:45:00Z' },
  ]);
  assert.deepEqual(steps.map((step) => step.state), ['done', 'done', 'current', 'upcoming']);
  assert.equal(steps[1].event.decision, 'approved');
});

/* ── Capacity ──────────────────────────────────────────────────── */

const job = (id, recruiterCode, priority, status = 'hiring') => ({ id, recruiterCode, priority, status });

test('Critical is capped at 2, Required at 5, Planned is unlimited', () => {
  const requests = [job('a', '257', 'critical'), job('b', '257', 'critical'), job('c', '257', 'required')];
  const critical = capacityCheck({ recruiterCode: '257', priority: 'critical', requests });
  assert.equal(critical.ok, false);
  assert.deepEqual(critical.exceeded, ['critical']);
  assert.deepEqual({ critical: critical.current.critical, required: critical.current.required }, { critical: 2, required: 1 });

  const fiveRequired = [1, 2, 3, 4, 5].map((n) => job(`r${n}`, '420', 'required'));
  assert.equal(capacityCheck({ recruiterCode: '420', priority: 'required', requests: fiveRequired }).ok, false);
  assert.equal(capacityCheck({ recruiterCode: '420', priority: 'required', requests: fiveRequired.slice(1) }).ok, true);

  const manyPlanned = Array.from({ length: 30 }, (_, n) => job(`p${n}`, '389', 'planned'));
  assert.equal(capacityCheck({ recruiterCode: '389', priority: 'planned', requests: manyPlanned }).ok, true);
});

test('only committed work counts: pending, completed and cancelled jobs occupy no seat', () => {
  const requests = [
    job('a', '257', 'critical', 'pending_approval'),
    job('b', '257', 'critical', 'completed'),
    job('c', '257', 'critical', 'cancelled'),
    job('d', '257', 'critical', 'on_hold'),
  ];
  const check = capacityCheck({ recruiterCode: '257', priority: 'critical', requests });
  assert.equal(check.current.critical, 1, 'the held job still occupies its seat');
  assert.equal(check.ok, true);
  const notCountingHolds = capacityCheck({ recruiterCode: '257', priority: 'critical', requests, limits: { critical: 2, required: 5, planned: null, countOnHold: false } });
  assert.equal(notCountingHolds.current.critical, 0);
});

test('reassigning or re-prioritising a job does not count the job against itself', () => {
  const requests = [job('a', '257', 'critical'), job('b', '257', 'required')];
  // Moving b from Required to Critical: b must not be counted twice.
  const upgrade = capacityCheck({ recruiterCode: '257', priority: 'critical', requests, excludeRequestId: 'b' });
  assert.equal(upgrade.projected.critical, 2);
  assert.equal(upgrade.projected.required, 0);
  assert.equal(upgrade.ok, true);
  const thirdCritical = capacityCheck({ recruiterCode: '257', priority: 'critical', requests: [...requests, job('c', '257', 'critical')], excludeRequestId: 'b' });
  assert.equal(thirdCritical.ok, false);
});

test('capacity levels read full at the limit and over past it', () => {
  const loads = loadByRecruiter([job('a', '257', 'critical'), job('b', '257', 'critical'), job('c', '420', 'critical')]);
  assert.deepEqual(capacityLevel(loads.get('257')), { critical: 'full', required: 'ok', planned: 'ok' });
  assert.deepEqual(capacityLevel({ critical: 3, required: 6, planned: 40 }), { critical: 'over', required: 'over', planned: 'ok' });
});

/* ── Classification ────────────────────────────────────────────── */

test('classification is taken from the title only when it is unambiguous', () => {
  assert.equal(classificationFromTitle('Senior Mechanical Instructor'), 'instructor');
  assert.equal(classificationFromTitle('CMRP Instructor'), 'instructor');
  assert.equal(classificationFromTitle('Instructor(SCADA)'), 'instructor');
  assert.equal(classificationFromTitle('IT Teamleader'), 'team_leader');
  assert.equal(classificationFromTitle('Sales Operation T.L'), 'team_leader');
  assert.equal(classificationFromTitle('Academic Manager'), 'manager');
  assert.equal(classificationFromTitle('Marketing Director'), 'manager');
  assert.equal(classificationFromTitle('Senior E-commerce Specialist'), 'senior');
  assert.equal(classificationFromTitle('Customer service Agent'), 'agent');
  assert.equal(classificationFromTitle('Telesales(KSA)'), 'agent');
  assert.equal(classificationFromTitle('Instructional Designer'), null, '"Instructional" is not "Instructor"');
  assert.equal(classificationFromTitle('UI/UX Developer'), null);
  assert.equal(classificationFromTitle('Instructor Team Leader'), null, 'two kinds of role is a question for a person');
});

test('locations resolve to EG or KSA and nothing else is guessed', () => {
  assert.equal(locationCode('EG'), 'EG');
  assert.equal(locationCode('Cairo'), 'EG');
  assert.equal(locationCode('KSA'), 'KSA');
  assert.equal(locationCode('Riyadh office'), 'KSA');
  assert.equal(locationCode('Remote'), null);
  assert.equal(locationCode(''), null);
});

/* ── Settings ──────────────────────────────────────────────────── */

test('the default settings are valid and resolve over an empty document', () => {
  assert.equal(validateHRSettings(resolveHRSettings(null)), null);
  const policy = recruitmentPolicy(resolveHRSettings({}));
  assert.deepEqual(policy.calendar.weekend, [5, 6]);
  assert.equal(policy.capacity.critical, 2);
  assert.equal(policy.capacity.required, 5);
  assert.equal(policy.capacity.planned, null);
});

test('a stored override replaces only what it names', () => {
  const resolved = resolveHRSettings({ recruitment: { capacity: { critical: 3 } } });
  assert.equal(resolved.recruitment.capacity.critical, 3);
  assert.equal(resolved.recruitment.capacity.required, 5);
  assert.deepEqual(resolved.recruitment.classifications, DEFAULT_HR_SETTINGS.recruitment.classifications);
});

test('settings that would break the rules are refused', () => {
  const broken = (patch) => validateHRSettings(resolveHRSettings(patch))?.code;
  assert.equal(broken({ recruitment: { calendar: { weekend: [0, 1, 2, 3, 4, 5] } } }), 'hr_settings_weekend_invalid');
  assert.equal(broken({ recruitment: { sla: { bands: { critical: { min: 10, max: 5, default: 7 } } } } }), 'hr_settings_sla_band_invalid');
  assert.equal(broken({ kpi: { weights: { hr_review: 40, hiring_target: 30, commitment: 20, system_quality: 20 } } }), 'kpi_weights_must_total_100');
  assert.equal(broken({ kpi: { rules: { cv_missing: { points: 50 } } } }), 'kpi_rule_points_invalid');
  assert.equal(broken({ recruitment: { classifications: [{ id: 'instructor', ar: 'مدرب', en: 'Instructor' }, { id: 'instructor', ar: 'x', en: 'y' }] } }), 'hr_settings_classifications_invalid');
});

/* ── Alerts ────────────────────────────────────────────────────── */

test('alerts are raised by real rules and link to the exact problem', () => {
  const policy = recruitmentPolicy(resolveHRSettings({}));
  const requests = [
    { id: 'j1', title: 'CFM Instructor', status: 'hiring', priority: 'critical', recruiterCode: '257', sla: { startDate: '2026-09-20', targetWorkingDays: 15 } },
    { id: 'j2', title: 'CMRP Instructor', status: 'hiring', priority: 'critical', recruiterCode: '257', sla: { startDate: '2026-09-24', targetWorkingDays: 15 } },
    { id: 'j3', title: 'Power BI Senior', status: 'hiring', priority: 'required', recruiterCode: '420', sla: { startDate: '2026-09-03', targetWorkingDays: 30 } },
    { id: 'j4', title: 'Mechanical Instructor', status: 'pending_approval', priority: 'critical', recruiterCode: null },
  ];
  const alerts = deriveRecruitmentAlerts({
    requests,
    names: new Map([['257', { ar: 'شهندا سمير', en: 'Shahinda Samir' }]]),
    policy,
    linkedRequestIds: new Set(['j1', 'j2', 'j3']),
    today: '2026-10-13',
  });
  const byId = new Map(alerts.map((alert) => [alert.id, alert]));

  const capacity = byId.get('capacity_critical:257');
  assert.equal(capacity.severity, 'warning');
  assert.match(capacity.body.en, /Shahinda Samir reached the maximum Critical workload: 2 \/ 2/);
  assert.equal(capacity.link, '/hr/recruitment/capacity?recruiter=257');

  assert.equal(byId.get('sla_overdue:j1').severity, 'critical');
  assert.match(byId.get('sla_overdue:j1').body.en, /2 working days overdue/);
  assert.equal(byId.get('sla_overdue:j1').link, '/hr/recruitment/requests/j1');

  // j3 started 2026-09-03 with 30 working days; on 2026-10-13 two remain.
  assert.equal(byId.get('sla_due_soon:j3').params.days, 2);
  assert.match(byId.get('sla_due_soon:j3').body.en, /Power BI Senior has only 2 working days remaining/);
  assert.equal(byId.get('unassigned:j4').type, 'critical_unassigned');
  assert.equal(byId.get('unassigned:j4').severity, 'critical');
  assert.equal(alerts[0].severity, 'critical', 'critical alerts sort first');
});

test('an approved job with no Odoo link raises an alert after the grace period', () => {
  const policy = recruitmentPolicy(resolveHRSettings({}));
  const request = { id: 'j', title: 'Video Editor', status: 'hiring', priority: 'required', recruiterCode: '257', sla: { startDate: '2026-09-20', targetWorkingDays: 30 } };
  const early = deriveRecruitmentAlerts({ requests: [request], policy, today: '2026-09-21' });
  assert.equal(early.some((alert) => alert.type === 'odoo_unlinked'), false);
  const later = deriveRecruitmentAlerts({ requests: [request], policy, today: '2026-09-24' });
  assert.equal(later.some((alert) => alert.type === 'odoo_unlinked'), true);
});

test('Arabic day counts agree with their number', () => {
  assert.equal(arabicWorkingDays(1), 'يوم عمل واحد');
  assert.equal(arabicWorkingDays(2), 'يوما عمل');
  assert.equal(arabicWorkingDays(4), '4 أيام عمل');
  assert.equal(arabicWorkingDays(15), '15 يوم عمل');
});

/* ── Permissions ───────────────────────────────────────────────── */

test('every HR V2 key exists and administrators hold all of them', () => {
  for (const key of ['hr.recruitment.view', 'hr.recruitment.request', 'hr.recruitment.review', 'hr.recruitment.approve', 'hr.recruitment.assign', 'hr.recruitment.extend', 'hr.recruitment.kpi.review', 'hr.recruitment.rewards.manage', 'hr.personnel.view', 'hr.personnel.manage', 'hr.performance.review', 'hr.settings.manage']) {
    assert.ok(ALL_PERMISSIONS.includes(key), key);
    assert.ok(ROLES.admin.permissions.includes(key), key);
  }
});

test('a frozen hr.manage array keeps running HR but never gains the authority keys', () => {
  const salah = { role: 'manager', status: 'active', permissions: ['hr.view', 'hr.manage', 'hr.payroll'] };
  const effective = permissionsFor(salah);
  for (const key of ['hr.recruitment.view', 'hr.recruitment.request', 'hr.recruitment.assign', 'hr.recruitment.kpi.review', 'hr.personnel.manage', 'hr.performance.review']) {
    assert.ok(effective.includes(key), key);
  }
  for (const key of ['hr.recruitment.approve', 'hr.recruitment.extend', 'hr.recruitment.review', 'hr.recruitment.override_capacity', 'hr.recruitment.rewards.manage', 'hr.settings.manage']) {
    assert.equal(effective.includes(key), false, key);
  }
  assert.equal(can(salah, PERMISSIONS.HR_PAYROLL), true);
});

test('an array saved after the split is read literally', () => {
  const explicit = { role: 'member', status: 'active', permissions: ['hr.manage', 'hr.recruitment.view'] };
  assert.deepEqual(permissionsFor(explicit), ['hr.manage', 'hr.recruitment.view']);
  const viewer = { role: 'member', status: 'active', permissions: ['hr.view'] };
  assert.equal(can(viewer, PERMISSIONS.HR_RECRUITMENT_VIEW), true);
  assert.equal(can(viewer, PERMISSIONS.HR_PAYROLL), false, 'deriving recruitment view never opens payroll');
});

test('a department manager may request and review, but not approve or extend', () => {
  const manager = { role: 'manager', status: 'active', permissions: null };
  assert.equal(can(manager, PERMISSIONS.HR_RECRUITMENT_REQUEST), true);
  assert.equal(can(manager, PERMISSIONS.HR_RECRUITMENT_REVIEW), true);
  assert.equal(can(manager, PERMISSIONS.HR_RECRUITMENT_APPROVE), false);
  assert.equal(can(manager, PERMISSIONS.HR_RECRUITMENT_EXTEND), false);
  assert.equal(can(manager, PERMISSIONS.HR_RECRUITMENT_VIEW), false);
});
