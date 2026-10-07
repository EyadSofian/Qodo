/**
 * The recruitment clock — what happens without anybody opening a page.
 *
 *  • Forms reward batches the moment a third qualifying job closes.
 *  • Pushes new alerts to the people who can act on them, once. A ledger keeps
 *    which alert (and which version of it — "2 days overdue" vs "5") has been
 *    sent; only a critical alert whose figure changed is repeated, and at most
 *    every other day, so an overdue job is a reminder and not a siren.
 *  • Runs the automatic KPI checks once a day. They read Odoo, which is slow,
 *    so they never run on a page request. Whoever a check deducts from is
 *    told the same day, with the desk: a deduction nobody hears about cannot
 *    be put right.
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
import { syncOdooJobs, syncOdooJobsEverywhere } from './odooSync.js';
import { recruitmentSourceIsOdoo } from './odooJobs.js';

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

const KPI_LINK = '/hr/recruitment/kpi';

/**
 * Said once, the day automatic checks start reading Odoo's own jobs: to the
 * recruiters who have an account, the desk and whoever reviews KPI.
 */
async function announceAutomaticChecks(ctx) {
  if (!recruitmentSourceIsOdoo()) return 0;
  const key = `hr.recruitment.announced.odooKpiChecks.${ctx.organizationId}`;
  if (await getSetting(key)) return 0;
  await setSetting(key, ctx.today);
  const recruiters = ctx.team.map((member) => member.linkedUserId);
  const desk = (await usersWith(ctx.organizationId, PERMISSIONS.HR_RECRUITMENT_ASSIGN)).map((user) => user.id);
  const reviewers = (await usersWith(ctx.organizationId, PERMISSIONS.HR_RECRUITMENT_KPI_REVIEW)).map((user) => user.id);
  const userIds = [...new Set([...recruiters, ...desk, ...reviewers].filter(Boolean))];
  await notifyEach(userIds, null, {
    type: 'recruitment.kpi.automatic_checks_on',
    title: { ar: 'الفحص التلقائي لمؤشرات التوظيف يعمل على وظائف Odoo', en: 'Automatic recruitment KPI checks now cover Odoo jobs' },
    body: {
      ar: 'من الغد يراجع النظام مرشحي كل وظيفة في Odoo يومياً ويخصم من "جودة النظام والإجراءات": مرشح مقبول بلا CV (3)، ملف مرشح مقبول ناقص البريد أو الهاتف أو الراتب المتوقع (2)، مرشح في مرحلة المقابلة بلا موعد مسجّل (2). ما يُصحَّح في Odoo قبل الفحص لا يُخصم.',
      en: 'From tomorrow the system reviews each job\'s candidates in Odoo daily and deducts from "System & Process Quality": an accepted candidate with no CV (3), an accepted candidate missing e-mail, phone or expected salary (2), an interview-stage candidate with no scheduled interview (2). Anything corrected in Odoo before the check is not deducted.',
    },
    link: KPI_LINK,
  });
  return userIds.length;
}

/** Tell each recruiter what today's checks found on their jobs, and the desk the total. */
async function notifyAutomaticFindings(ctx, raised) {
  if (!raised.length) return;
  const byRecruiter = new Map();
  for (const event of raised) byRecruiter.set(event.employeeCode, [...(byRecruiter.get(event.employeeCode) ?? []), event]);
  for (const [code, events] of byRecruiter) {
    const points = events.reduce((sum, event) => sum + (Number(event.deduction) || 0), 0);
    await notifyEach([ctx.profiles.get(code)?.linkedUserId], null, {
      type: 'recruitment.kpi.automatic_findings',
      title: { ar: 'خصم تلقائي على مؤشرات التوظيف', en: 'Automatic recruitment KPI deduction' },
      body: {
        ar: `${events.length} ملاحظة جديدة على وظائفك في Odoo (${points} نقطة). افتح مؤشرات التوظيف لمعرفة المرشح والسبب.`,
        en: `${events.length} new finding(s) on your Odoo jobs (${points} points). Open Recruitment KPI to see the candidate and the reason.`,
      },
      link: `${KPI_LINK}?recruiter=${encodeURIComponent(code)}`,
    });
  }
  const reviewers = [
    ...(await usersWith(ctx.organizationId, PERMISSIONS.HR_RECRUITMENT_KPI_REVIEW)),
    ...(await usersWith(ctx.organizationId, PERMISSIONS.HR_RECRUITMENT_ASSIGN)),
  ].map((user) => user.id);
  await notifyEach(reviewers, null, {
    type: 'recruitment.kpi.automatic_findings',
    title: { ar: 'خصومات تلقائية جديدة على مؤشرات التوظيف', en: 'New automatic recruitment KPI deductions' },
    body: {
      ar: `سجّل الفحص اليومي ${raised.length} ملاحظة على ${byRecruiter.size} من مسؤولي التوظيف. يمكن إلغاء أي خصم غير صحيح من صفحة المؤشرات.`,
      en: `Today's check recorded ${raised.length} finding(s) on ${byRecruiter.size} recruiter(s). A wrong deduction can be voided on the KPI page.`,
    },
    link: KPI_LINK,
  });
}

let running = false;

export async function runRecruitmentClock(organizationId, { withKpiChecks = true } = {}) {
  if (running) return null;
  running = true;
  try {
    // The desk follows Odoo's published board first, so alerts and rewards read today's jobs.
    const synced = await syncOdooJobs(organizationId).catch((error) => {
      console.warn('[hr] Odoo job sync skipped:', error?.message ?? error);
      return null;
    });
    if (synced && (synced.created || synced.restored || synced.updated || synced.archived)) {
      console.log(`[hr] Odoo job sync for ${organizationId}: ${synced.created} new, ${synced.restored} back, ${synced.updated} updated, ${synced.archived} archived`);
    }
    const created = await syncRewardBatches(organizationId);
    const ctx = await recruitmentContext(systemActor(organizationId));
    const batches = await find('recruitmentRewardBatches', (batch) => batch.organizationId === organizationId);
    const sent = await notifyNewAlerts(ctx, batches);
    let raised = [];
    if (withKpiChecks) {
      const dayKey = `hr.recruitment.kpiChecks.lastDay.${organizationId}`;
      const checkedToday = (await getSetting(dayKey)) === ctx.today;
      // The announcement goes out on a day the checks have already run, so
      // people hear the rule before the first deduction rather than with it.
      const announced = checkedToday ? await announceAutomaticChecks(ctx) : 0;
      if (announced) console.log(`[hr] automatic KPI checks announced to ${announced} account(s) for ${organizationId}`);
      if (!checkedToday) {
        await setSetting(dayKey, ctx.today);
        raised = await runAutomaticKpiChecks(organizationId, { ctx });
        await notifyAutomaticFindings(ctx, raised);
      }
    }
    return { batches: created.length, alerts: sent, kpiEvents: raised.length };
  } finally {
    running = false;
  }
}

/** Boot: bring the legacy workbook in (idempotent; nothing when Odoo is the source), then line the desk up with Odoo. */
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
  // Not awaited: a slow Odoo must not hold the server's start. It never throws,
  // and the scheduler's first tick runs the same sync again.
  void syncOdooJobsEverywhere();
}
