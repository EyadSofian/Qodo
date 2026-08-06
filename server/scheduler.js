/**
 * Scheduled notifications.
 *
 * Two jobs, both optional and both silent when push is not configured:
 *
 *   • a once-a-day digest of how much work each department is carrying
 *   • a watcher that pings when the Insights Hub publishes a new sync
 *
 * Deliberately an in-process timer rather than a cron dependency — the same
 * choice the Insights Hub itself made. The cost is that a restart could re-fire
 * a job, so both persist their last run and check it before sending: a redeploy
 * at 9:05 must not send the morning digest twice.
 */

import { create, find, findOne, getStore } from './store.js';
import { notifyUser, pushConfigured } from './push.js';
import { PERMISSIONS, can, isActiveUser } from '../shared/permissions.js';
import { DEFAULT_DEPARTMENT, DEPARTMENTS, isSettledStage } from '../shared/departments.js';
import { organizationOf } from '../shared/organization.js';
import { isAssignee } from '../shared/workflow.js';
import { remindDueSoon } from './management.js';

const TICK_MS = 60 * 1000;
const DIGEST_HOUR = Number(process.env.DIGEST_HOUR ?? 9);
const TIMEZONE = process.env.DIGEST_TIMEZONE || 'Africa/Cairo';
const INSIGHTS_POLL_MINUTES = Number(process.env.INSIGHTS_POLL_MINUTES ?? 30);
/** How far ahead a management item is warned about. */
const DESK_REMINDER_MINUTES = Number(process.env.MANAGEMENT_REMINDER_MINUTES ?? 60);

/* ── tiny persisted key/value ────────────────────────────────────── */

async function getSetting(key) {
  const row = await findOne('settings', (s) => s.id === key);
  return row?.value ?? null;
}

async function setSetting(key, value) {
  const store = await getStore();
  const existing = await findOne('settings', (s) => s.id === key);
  if (existing) await store.update('settings', key, { value });
  else await create('settings', { id: key, value });
}

/**
 * "Today" in the workspace's timezone, as YYYY-MM-DD. The server runs in UTC on
 * Railway, so a naive `new Date()` would roll the day over at the wrong moment
 * and fire the 9am digest in the middle of the night.
 */
function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

/* ── job 1: the daily digest ─────────────────────────────────────── */

const dept = (task) => task.department ?? DEFAULT_DEPARTMENT;

async function buildDigest(organizationId) {
  const tasks = await find(
    'tasks',
    (task) => organizationOf(task) === organizationId
  );
  const open = tasks.filter((t) => !isSettledStage(dept(t), t.stage));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = (t) =>
    t.dueDate && new Date(`${t.dueDate}T00:00:00`).getTime() < today.getTime();

  const perDepartment = DEPARTMENTS.map((d) => {
    const mine = open.filter((t) => dept(t) === d.id);
    return { id: d.id, ar: d.ar, en: d.en, open: mine.length, overdue: mine.filter(isOverdue).length };
  }).filter((d) => d.open > 0);

  return {
    totalOpen: open.length,
    totalOverdue: open.filter(isOverdue).length,
    perDepartment,
    open,
    isOverdue,
  };
}

async function sendDigest() {
  const users = await find('users', isActiveUser);
  const digests = new Map();

  for (const user of users) {
    const organizationId = organizationOf(user);
    if (!digests.has(organizationId)) {
      digests.set(organizationId, await buildDigest(organizationId));
    }
    const digest = digests.get(organizationId);

    /**
     * A manager's own queue is easy to lose behind the team's totals, so the
     * team line always ends with their personal count. Nobody manages so much
     * that they stop having work of their own.
     */
    const own = digest.open.filter((task) => isAssignee(user, task));
    const ownLate = own.filter(digest.isOverdue).length;
    const ownLine = own.length
      ? {
          ar: ` · مهامك أنت: ${own.length}${ownLate ? ` (${ownLate} متأخرة)` : ''}`,
          en: ` · Yours: ${own.length}${ownLate ? ` (${ownLate} late)` : ''}`,
        }
      : { ar: '', en: '' };

    // Administrators see the company picture. Team managers get their
    // department only; everyone else gets their own workload.
    if (can(user, PERMISSIONS.TASKS_VIEW_ALL)) {
      if (digest.totalOpen === 0) continue;

      const lines = digest.perDepartment
        .slice(0, 5)
        .map((d) => `${d.ar}: ${d.open}${d.overdue ? ` (${d.overdue} متأخرة)` : ''}`);
      const linesEn = digest.perDepartment
        .slice(0, 5)
        .map((d) => `${d.en}: ${d.open}${d.overdue ? ` (${d.overdue} late)` : ''}`);

      await notifyAndRecord(user.id, {
        type: 'digest.daily',
        title: {
          ar: `ملخص اليوم — ${digest.totalOpen} مهمة مفتوحة`,
          en: `Today — ${digest.totalOpen} open task${digest.totalOpen === 1 ? '' : 's'}`,
        },
        body: {
          ar: lines.join(' · ') + ownLine.ar,
          en: linesEn.join(' · ') + ownLine.en,
        },
        link: '/tasks',
      });
      continue;
    }

    // The team digest is supervision, so it follows the reviewing authority
    // rather than the ability to edit a colleague's card.
    if (can(user, PERMISSIONS.TASKS_REVIEW)) {
      const department = user.department ?? DEFAULT_DEPARTMENT;
      const team = digest.open.filter((task) => dept(task) === department);
      if (team.length === 0) continue;
      const late = team.filter(digest.isOverdue).length;
      const label = DEPARTMENTS.find((item) => item.id === department);
      await notifyAndRecord(user.id, {
        type: 'digest.daily',
        title: {
          ar: `${label?.ar ?? 'فريقك'} — ${team.length} مهمة مفتوحة`,
          en: `${label?.en ?? 'Your team'} — ${team.length} open task${team.length === 1 ? '' : 's'}`,
        },
        body: {
          ar: (late ? `منها ${late} متأخرة عن موعدها.` : 'لا توجد مهام متأخرة.') + ownLine.ar,
          en: (late ? `${late} of them are past due.` : 'No overdue tasks.') + ownLine.en,
        },
        link: '/tasks',
      });
      continue;
    }

    const mine = digest.open.filter((t) => isAssignee(user, t));
    if (mine.length === 0) continue;
    const late = mine.filter(digest.isOverdue).length;

    await notifyAndRecord(user.id, {
      type: 'digest.daily',
      title: {
        ar: `لديك ${mine.length} مهمة مفتوحة اليوم`,
        en: `You have ${mine.length} open task${mine.length === 1 ? '' : 's'} today`,
      },
      body: {
        ar: late ? `منها ${late} متأخرة عن موعدها.` : 'لا يوجد متأخر — أحسنت.',
        en: late ? `${late} of them are past their due date.` : 'None overdue — nice.',
      },
      link: '/tasks',
    });
  }
}

/* ── job 2: the Insights Hub watcher ─────────────────────────────── */

/** First and last day of the month we are currently in, as `YYYY-MM-DD`. */
function monthBounds(date = new Date()) {
  const { day } = localParts(date);
  const [year, month] = day.split('-');
  const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${String(last).padStart(2, '0')}` };
}

async function checkInsights() {
  const app = await findOne('apps', (a) => a.id === 'insights');
  if (!app?.url || app.enabled === false) return;

  /**
   * Scoped to the month we are in rather than everything the dashboard holds.
   *
   * The unscoped total covers the whole year, so it moves by a fraction of a
   * percent on any given sync — a number that large stops being news and starts
   * being wallpaper. "This month" is the figure somebody can actually act on,
   * and it is the one they would have gone to the dashboard to filter for.
   */
  const { from, to } = monthBounds();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let data;
  try {
    const response = await fetch(
      `${app.url.replace(/\/$/, '')}/api/overview?from=${from}&to=${to}`,
      { signal: controller.signal, headers: { Accept: 'application/json' } }
    );
    if (!response.ok) return;
    data = await response.json();
  } catch {
    // A dashboard that is down is not an event worth waking anyone for.
    return;
  } finally {
    clearTimeout(timer);
  }

  const syncedAt = data?.syncedAt;
  if (!syncedAt) return;

  const previous = await getSetting('insights.lastSyncedAt');
  if (previous === syncedAt) return;
  await setSetting('insights.lastSyncedAt', syncedAt);

  // First run just records the current state — otherwise every fresh
  // deployment would announce a "new" sync that nobody actually caused.
  if (!previous) return;

  const t = data.totals ?? {};
  const money = (value) =>
    typeof value === 'number' ? Math.round(value).toLocaleString('en-US') : null;
  const spend = money(t.spend);
  // `accountingRevenue` is what the books say was invoiced; `revenue` is its
  // alias on this dashboard. Falling back keeps the line honest if they diverge.
  const revenue = money(t.accountingRevenue ?? t.revenue);
  const invoices = typeof t.invoicedOrders === 'number' ? t.invoicedOrders : null;

  const monthName = new Intl.DateTimeFormat('ar-EG', { timeZone: TIMEZONE, month: 'long' }).format(
    new Date()
  );

  const arabic = [
    spend ? `إنفاق ${spend}` : null,
    revenue ? `إيراد ${revenue}` : null,
    invoices ? `${invoices} فاتورة` : null,
  ].filter(Boolean);
  const english = [
    spend ? `Spend ${spend}` : null,
    revenue ? `revenue ${revenue}` : null,
    invoices ? `${invoices} invoices` : null,
  ].filter(Boolean);

  // Only people who can open the app should hear about it.
  const users = await find('users', isActiveUser);
  for (const user of users) {
    const allowed = user.role === 'admin' || !Array.isArray(user.appIds) || user.appIds.includes('insights');
    if (!allowed || !can(user, PERMISSIONS.APPS_VIEW)) continue;

    await notifyAndRecord(user.id, {
      type: 'insights.updated',
      title: {
        ar: `التسويق والمبيعات — ${monthName}`,
        en: 'Insights Hub has new data',
      },
      body: {
        ar: arabic.length ? arabic.join(' · ') : 'تم تحديث البيانات.',
        en: english.length ? english.join(' · ') : 'The data has been refreshed.',
      },
      link: '/app/insights',
    });
  }
}

/* ── shared delivery ─────────────────────────────────────────────── */

/** Writes the in-app notification and sends the push, so both stay in step. */
async function notifyAndRecord(userId, { type, title, body, link }) {
  const text = typeof body === 'string' ? body : (body.ar ?? '');
  const user = await findOne('users', (candidate) => candidate.id === userId);
  await create('notifications', {
    organizationId: organizationOf(user),
    userId,
    type,
    title,
    body: text,
    link,
    read: false,
  });
  await notifyUser(userId, { title, body: text, link });
}

/* ── the loop ────────────────────────────────────────────────────── */

let started = false;

export function startScheduler() {
  if (started) return;
  started = true;

  if (!pushConfigured()) {
    console.log('[scheduler] push not configured — digest and watchers stay off');
    return;
  }

  console.log(
    `[scheduler] daily digest at ${DIGEST_HOUR}:00 ${TIMEZONE}; ` +
      `Insights checked every ${INSIGHTS_POLL_MINUTES} min; ` +
      `management reminders ${DESK_REMINDER_MINUTES} min ahead`
  );

  let lastInsightsCheck = 0;

  const tick = async () => {
    try {
      const { day, hour } = localParts();

      if (hour === DIGEST_HOUR && (await getSetting('digest.lastSentDay')) !== day) {
        // Stamp before sending: a crash mid-send must not cause a second full
        // round of notifications on the next tick.
        await setSetting('digest.lastSentDay', day);
        await sendDigest();
        console.log(`[scheduler] daily digest sent for ${day}`);
      }

      if (Date.now() - lastInsightsCheck >= INSIGHTS_POLL_MINUTES * 60 * 1000) {
        lastInsightsCheck = Date.now();
        await checkInsights();
      }

      // Every tick, because a meeting an hour away is only useful news for the
      // hour before it. The item itself records that it has been warned about,
      // so running this a minute later never sends the same reminder twice.
      for (const organization of await find('organizations')) {
        const sent = await remindDueSoon(organization.id, DESK_REMINDER_MINUTES);
        if (sent) console.log(`[scheduler] ${sent} management reminder(s) sent`);
      }
    } catch (err) {
      console.error('[scheduler]', err);
    }
  };

  const timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  tick();
}
