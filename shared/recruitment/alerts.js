/**
 * Recruitment alerts — derived from the jobs, never stored as badges.
 *
 * Every alert here is a business rule reading live data: a recruiter at the
 * Critical limit, a job past its due date, a Critical job nobody owns. Because
 * they are derived on read they cannot go stale; the server keeps only a
 * ledger of which ones it has already pushed to somebody's phone, and the
 * browser keeps which ones this viewer has already seen as a popup.
 *
 * Each alert names its subject and a link to the exact job or recruiter, so
 * clicking one always lands on the problem rather than on a list containing it.
 */

import { capacityLevel, limitFor, loadByRecruiter } from './capacity.js';
import { slaSnapshot, workingDaysBetween } from './sla.js';

export const ALERT_SEVERITIES = ['critical', 'warning', 'info', 'success'];
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2, success: 3 };

/** Arabic counts its nouns: 1 يوم، 2 يوما، 3–10 أيام، 11+ يوم. */
export function arabicWorkingDays(count) {
  const n = Math.abs(Math.trunc(Number(count) || 0));
  if (n === 1) return 'يوم عمل واحد';
  if (n === 2) return 'يوما عمل';
  if (n >= 3 && n <= 10) return `${n} أيام عمل`;
  return `${n} يوم عمل`;
}

export function englishWorkingDays(count) {
  const n = Math.abs(Math.trunc(Number(count) || 0));
  return `${n} working day${n === 1 ? '' : 's'}`;
}

function jobLink(request) {
  return `/hr/recruitment/requests/${encodeURIComponent(request.id)}`;
}

function recruiterLink(code) {
  return `/hr/recruitment/capacity?recruiter=${encodeURIComponent(code)}`;
}

/**
 * @param {object} input
 * @param {object[]} input.requests   recruitment requests
 * @param {Map<string,{ar:string,en:string}>} input.names  recruiter code → short names
 * @param {object} input.policy       `recruitmentPolicy(settings)`
 * @param {Set<string>} input.linkedRequestIds  requests with a confirmed Odoo link
 * @param {object[]} [input.readyBatches]  reward batches in status `ready`
 * @param {string} input.today
 */
export function deriveRecruitmentAlerts({ requests = [], names = new Map(), policy, linkedRequestIds = new Set(), readyBatches = [], today }) {
  const alerts = [];
  const nameOf = (code) => names.get(code) ?? { ar: code ? `#${code}` : '—', en: code ? `#${code}` : '—' };
  const calendar = policy?.calendar;
  const limits = policy?.capacity;

  // Capacity, one alert per recruiter and level.
  const loads = loadByRecruiter(requests, { countOnHold: limits?.countOnHold !== false });
  for (const [code, load] of loads) {
    const level = capacityLevel(load, limits);
    for (const priority of ['critical', 'required']) {
      if (level[priority] === 'ok') continue;
      const limit = limitFor(priority, limits);
      const count = load[priority];
      const name = nameOf(code);
      const over = level[priority] === 'over';
      const label = priority === 'critical' ? { ar: 'حرجة', en: 'Critical' } : { ar: 'مطلوبة', en: 'Required' };
      alerts.push({
        id: `capacity_${priority}:${code}`,
        type: `capacity_${priority}`,
        // At the limit is a warning (amber); only past it is critical (red).
        severity: over ? 'critical' : 'warning',
        subject: { kind: 'recruiter', code },
        link: recruiterLink(code),
        fingerprint: `${count}/${limit}`,
        params: { code, count, limit, priority },
        title: over
          ? { ar: 'تجاوز السعة', en: 'Capacity exceeded' }
          : { ar: 'تنبيه سعة', en: 'Capacity warning' },
        body: over
          ? { ar: `${name.ar} تجاوز حد الوظائف ال${label.ar}: ${count} / ${limit}.`, en: `${name.en} is over the ${label.en} limit: ${count} / ${limit}.` }
          : { ar: `${name.ar} وصل للحد الأقصى من الوظائف ال${label.ar}: ${count} / ${limit} نشطة.`, en: `${name.en} reached the maximum ${label.en} workload: ${count} / ${limit} active.` },
        actions: ['view_workload', 'reassign'],
      });
    }
  }

  for (const request of requests) {
    const title = request.title || request.reference || request.id;

    if (request.status === 'hiring') {
      if (request.sla?.startDate) {
        const snapshot = slaSnapshot(request.sla, { today, calendar, dueSoonWorkingDays: policy?.dueSoonWorkingDays ?? 3 });
        if (snapshot.state === 'overdue') {
          alerts.push({
            id: `sla_overdue:${request.id}`,
            type: 'sla_overdue',
            severity: 'critical',
            subject: { kind: 'job', id: request.id },
            link: jobLink(request),
            fingerprint: String(snapshot.overdueWorkingDays),
            params: { days: snapshot.overdueWorkingDays, dueDate: snapshot.dueDate },
            title: { ar: 'وظيفة متأخرة', en: 'Job overdue' },
            body: { ar: `${title} متأخرة ${arabicWorkingDays(snapshot.overdueWorkingDays)}.`, en: `${title} is ${englishWorkingDays(snapshot.overdueWorkingDays)} overdue.` },
            actions: ['open_job', 'extend'],
          });
        } else if (snapshot.state === 'due_today') {
          alerts.push({
            id: `sla_due_today:${request.id}`,
            type: 'sla_due_today',
            severity: 'warning',
            subject: { kind: 'job', id: request.id },
            link: jobLink(request),
            fingerprint: snapshot.dueDate,
            params: { dueDate: snapshot.dueDate },
            title: { ar: 'تستحق اليوم', en: 'Due today' },
            body: { ar: `${title} تستحق اليوم.`, en: `${title} is due today.` },
            actions: ['open_job'],
          });
        } else if (snapshot.state === 'due_soon') {
          alerts.push({
            id: `sla_due_soon:${request.id}`,
            type: 'sla_due_soon',
            severity: 'warning',
            subject: { kind: 'job', id: request.id },
            link: jobLink(request),
            fingerprint: String(snapshot.remainingWorkingDays),
            params: { days: snapshot.remainingWorkingDays, dueDate: snapshot.dueDate },
            title: { ar: 'اقترب موعد الاستحقاق', en: 'Due soon' },
            body: { ar: `${title} متبقٍ لها ${arabicWorkingDays(snapshot.remainingWorkingDays)} فقط.`, en: `${title} has only ${englishWorkingDays(snapshot.remainingWorkingDays)} remaining.` },
            actions: ['open_job'],
          });
        }
      }

      if (!request.priority) {
        alerts.push({
          id: `unclassified:${request.id}`,
          type: 'unclassified',
          severity: 'warning',
          subject: { kind: 'job', id: request.id },
          link: jobLink(request),
          fingerprint: 'none',
          params: {},
          title: { ar: 'أولوية غير محددة', en: 'Priority missing' },
          body: { ar: `${title} تحتاج تحديد أولوية حتى يُحسب الـSLA والسعة.`, en: `${title} needs a priority before its SLA and capacity can be tracked.` },
          actions: ['open_job'],
        });
      }

      const waitedForLink = request.sla?.startDate ? workingDaysBetween(request.sla.startDate, today, calendar) ?? 0 : 0;
      if (!linkedRequestIds.has(request.id) && waitedForLink >= (policy?.waits?.odooLinkWorkingDays ?? 2)) {
        alerts.push({
          id: `odoo_unlinked:${request.id}`,
          type: 'odoo_unlinked',
          severity: 'info',
          subject: { kind: 'job', id: request.id },
          link: `${jobLink(request)}#odoo`,
          fingerprint: 'unlinked',
          params: {},
          title: { ar: 'غير مربوطة بـOdoo', en: 'No Odoo job linked' },
          body: { ar: `${title} معتمدة ولا توجد وظيفة Odoo مربوطة بها.`, en: `${title} was approved but no Odoo job is linked.` },
          actions: ['link_odoo'],
        });
      }

      if (Number(request.headcount) > 0 && Number(request.accepted) >= Number(request.headcount)) {
        alerts.push({
          id: `ready_to_close:${request.id}`,
          type: 'ready_to_close',
          severity: 'info',
          subject: { kind: 'job', id: request.id },
          link: jobLink(request),
          fingerprint: `${request.accepted}/${request.headcount}`,
          params: { accepted: request.accepted, headcount: request.headcount },
          title: { ar: 'جاهزة للإغلاق', en: 'Ready to close' },
          body: { ar: `${title}: تم قبول ${request.accepted} من ${request.headcount}.`, en: `${title}: ${request.accepted} of ${request.headcount} accepted.` },
          actions: ['open_job'],
        });
      }
    }

    if (['hiring', 'pending_approval'].includes(request.status) && !request.recruiterCode) {
      const critical = request.priority === 'critical';
      alerts.push({
        id: `unassigned:${request.id}`,
        type: critical ? 'critical_unassigned' : 'unassigned',
        severity: critical ? 'critical' : 'warning',
        subject: { kind: 'job', id: request.id },
        link: jobLink(request),
        fingerprint: request.status,
        params: {},
        title: critical ? { ar: 'وظيفة حرجة بلا مسؤول', en: 'Critical job unassigned' } : { ar: 'وظيفة بلا مسؤول توظيف', en: 'Job without a recruiter' },
        body: critical
          ? { ar: `وظيفة حرجة بدون مسؤول توظيف: ${title}.`, en: `A Critical job has no assigned recruiter: ${title}.` }
          : { ar: `${title} بدون مسؤول توظيف.`, en: `${title} has no recruiter.` },
        actions: ['reassign'],
      });
    }

    const waiting = request.status === 'pending_review' || request.status === 'pending_approval';
    if (waiting && request.statusChangedAt) {
      const since = String(request.statusChangedAt).slice(0, 10);
      const waited = workingDaysBetween(since, today, calendar) ?? 0;
      const approval = request.status === 'pending_approval';
      const limit = approval ? policy?.waits?.approvalWorkingDays ?? 2 : policy?.waits?.reviewWorkingDays ?? 2;
      if (waited >= limit && limit > 0) {
        alerts.push({
          id: `${approval ? 'approval' : 'review'}_waiting:${request.id}`,
          type: approval ? 'approval_waiting' : 'review_waiting',
          severity: 'info',
          subject: { kind: 'job', id: request.id },
          link: jobLink(request),
          fingerprint: String(waited),
          params: { days: waited },
          title: approval ? { ar: 'بانتظار الاعتماد النهائي', en: 'Awaiting final approval' } : { ar: 'بانتظار مراجعة القسم', en: 'Awaiting department review' },
          body: approval
            ? { ar: `${title} بانتظار الاعتماد النهائي منذ ${arabicWorkingDays(waited)}.`, en: `${title} has waited ${englishWorkingDays(waited)} for final approval.` }
            : { ar: `${title} بانتظار مراجعة القسم منذ ${arabicWorkingDays(waited)}.`, en: `${title} has waited ${englishWorkingDays(waited)} for department review.` },
          actions: ['open_job'],
        });
      }
    }
  }

  for (const batch of readyBatches) {
    const name = nameOf(batch.employeeCode);
    alerts.push({
      id: `reward_ready:${batch.id}`,
      type: 'reward_ready',
      severity: 'success',
      subject: { kind: 'recruiter', code: batch.employeeCode },
      link: `/hr/recruitment/rewards?recruiter=${encodeURIComponent(batch.employeeCode)}`,
      fingerprint: batch.id,
      params: { jobs: batch.jobIds?.length ?? 0 },
      title: { ar: 'دفعة مكافأة جاهزة', en: 'Reward batch ready' },
      body: { ar: `${name.ar}: دفعة مكافأة جاهزة للاعتماد (${batch.jobIds?.length ?? 0} وظائف).`, en: `${name.en} has a reward batch ready for approval (${batch.jobIds?.length ?? 0} jobs).` },
      actions: ['open_rewards'],
    });
  }

  return alerts.sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] || left.id.localeCompare(right.id));
}
