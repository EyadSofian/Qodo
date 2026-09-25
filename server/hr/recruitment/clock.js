/**
 * The recruitment clock — what happens without anybody opening a page.
 *
 *  • Forms reward batches the moment a third qualifying job closes.
 *  • Pushes new alerts to the people who can act on them, once. A ledger keeps
 *    which alert (and which version of it — "2 days overdue" vs "5") has been
 *    sent; only a critical alert whose figure changed is repeated, and at most
 *    every other day, so an overdue job is a reminder and not a siren.
 *  • Runs the automatic KPI checks once a day. They read Odoo, which is slow,
 *    so they never run on a page request.
 */

import { create, find, findOne, getStore } from '../../store.js';
import { notifyEach } from '../../notify.js';
import { PERMISSIONS } from '../../../shared/permissions.js';
import { workingDaysBetween } from '../../../shared/recruitment/sla.js';
import { recruitmentContext, usersWith } from './context.js';
import { alertsForContext } from './desk.js';
import { runAutomaticKpiChecks } from './kpi.js';
import { syncRewardBatches } from './rewards.js';
import { migrateLegacyRecruitment } from './migration.js';

const REPEAT_CRITICAL_WORKING_DAYS = 2;

/** The clock acts as the organization itself, never as a person. */
export function systemActor(organizationId) {
  return { id: null, name: 'Qodo', organizationId, role: 'admin', status: 'active', permissions: null, department: 'general' };
}

async function getSetting(key) {
  return (await findOne('settings', (row) => row.id === key))?.value ?? null;
}

async function setSetting(key, value) {
  const existing = await findOne('settings', (row) => row.id === key);
  if (existing) await (await getStore()).update('settings', key, { value });
  else await create('settings', { id: key, value });
}

async function recipientsFor(ctx, alert) {
  const desk = (await usersWith(ctx.organizationId, PERMISSIONS.HR_RECRUITMENT_ASSIGN)).map((user) => user.id);
  const approvers = (await usersWith(ctx.organizationId, PERMISSIONS.HR_RECRUITMENT_APPROVE)).map((user) => user.id);
  const request = alert.subject.kind === 'job' ? ctx.requests.find((item) => item.id === alert.subject.id) : null;
  const recruiterUser = request?.recruiterCode ? ctx.profiles.get(request.recruiterCode)?.linkedUserId : alert.subject.kind === 'recruiter' ? ctx.profiles.get(alert.subject.code)?.linkedUserId : null;
  switch (alert.type) {
    case 'capacity_critical':
    case 'capacity_required':
      return [...desk, recruiterUser];
    case 'sla_overdue':
      return [...desk, ...approvers, recruiterUser];
    case 'sla_due_soon':
    case 'sla_due_today':
    case 'ready_to_close':
      return [...desk, recruiterUser];
    case 'critical_unassigned':
    case 'unassigned':
    case 'odoo_unlinked':
    case 'unclassified':
      return desk;
    case 'approval_waiting': {
      const chosen = ctx.settings.recruitment?.approvals?.finalApproverUserId;
      return chosen && approvers.includes(chosen) ? [chosen] : approvers;
    }
    case 'review_waiting': {
      const reviewers = (await usersWith(ctx.organizationId, PERMISSIONS.HR_RECRUITMENT_REVIEW, (user) => user.department === request?.departmentId)).map((user) => user.id);
      return reviewers.length ? reviewers : approvers;
    }
    default:
      return [];
  }
}

/**
 * Push alerts nobody has been told about yet. Returns how many went out.
 *
 * The very first run for an organization only records what is already open —
 * on the day HR V2 goes live that is every overdue and unassigned job at once,
 * and a burst of notifications about known problems would bury the ones that
 * matter. Those alerts stay in the in-app alert centre; anything that appears
 * afterwards is pushed.
 */
export async function notifyNewAlerts(ctx, batches) {
  const key = `hr.recruitment.alertLedger.${ctx.organizationId}`;
  const stored = await getSetting(key);
  const baseline = stored === null || stored === undefined;
  const ledger = stored ?? {};
  const alerts = alertsForContext(ctx, { batches, scope: 'all' }).filter((alert) => alert.type !== 'reward_ready');
  if (baseline) {
    await setSetting(key, Object.fromEntries(alerts.map((alert) => [alert.id, { fingerprint: alert.fingerprint, notifiedOn: ctx.today }])));
    return 0;
  }
  const next = {};
  let sent = 0;
  for (const alert of alerts) {
    const previous = ledger[alert.id];
    const changed = previous && previous.fingerprint !== alert.fingerprint;
    const due = !previous
      || (changed && alert.severity === 'critical' && (workingDaysBetween(previous.notifiedOn, ctx.today, ctx.policy.calendar) ?? 0) >= REPEAT_CRITICAL_WORKING_DAYS);
    if (due) {
      const userIds = (await recipientsFor(ctx, alert)).filter(Boolean);
      await notifyEach(userIds, null, { type: `recruitment.alert.${alert.type}`, title: alert.title, body: alert.body, link: alert.link });
      sent += 1;
      next[alert.id] = { fingerprint: alert.fingerprint, notifiedOn: ctx.today };
    } else {
      next[alert.id] = { fingerprint: previous.fingerprint, notifiedOn: previous.notifiedOn };
    }
  }
  // Resolved alerts drop out, so a problem that comes back is news again.
  await setSetting(key, next);
  return sent;
}

let running = false;

export async function runRecruitmentClock(organizationId, { withKpiChecks = true } = {}) {
  if (running) return null;
  running = true;
  try {
    const created = await syncRewardBatches(organizationId);
    const ctx = await recruitmentContext(systemActor(organizationId));
    const batches = await find('recruitmentRewardBatches', (batch) => batch.organizationId === organizationId);
    const sent = await notifyNewAlerts(ctx, batches);
    let raised = [];
    if (withKpiChecks) {
      const dayKey = `hr.recruitment.kpiChecks.lastDay.${organizationId}`;
      if ((await getSetting(dayKey)) !== ctx.today) {
        await setSetting(dayKey, ctx.today);
        raised = await runAutomaticKpiChecks(organizationId, { ctx });
      }
    }
    return { batches: created.length, alerts: sent, kpiEvents: raised.length };
  } finally {
    running = false;
  }
}

/** Boot: bring the legacy workbook in (idempotent) for every organization. */
export async function bootRecruitment() {
  const organizations = await find('organizations');
  for (const organization of organizations) {
    try {
      const result = await migrateLegacyRecruitment(organization.id);
      if (result.created) console.log(`[hr] recruitment migration for ${organization.id}: ${result.created} imported, ${result.existing} already present`);
    } catch (error) {
      console.error('[hr] recruitment migration failed', error);
    }
  }
}
