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
import { PERMISSIONS, can } from '../shared/permissions.js';
import { DEFAULT_DEPARTMENT, DEPARTMENTS, isDoneStage } from '../shared/departments.js';
import { organizationOf } from '../shared/organization.js';

const TICK_MS = 60 * 1000;
const DIGEST_HOUR = Number(process.env.DIGEST_HOUR ?? 9);
const TIMEZONE = process.env.DIGEST_TIMEZONE || 'Africa/Cairo';
const INSIGHTS_POLL_MINUTES = Number(process.env.INSIGHTS_POLL_MINUTES ?? 30);

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
  const open = tasks.filter((t) => !isDoneStage(dept(t), t.stage));

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
  const users = await find('users', (u) => u.status !== 'disabled');
  const digests = new Map();

  for (const user of users) {
    const organizationId = organizationOf(user);
    if (!digests.has(organizationId)) {
      digests.set(organizationId, await buildDigest(organizationId));
    }
    const digest = digests.get(organizationId);
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
        body: { ar: lines.join(' · '), en: linesEn.join(' · ') },
        link: '/tasks',
      });
      continue;
    }

    if (can(user, PERMISSIONS.TASKS_EDIT_ANY)) {
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
          ar: late ? `منها ${late} متأخرة عن موعدها.` : 'لا توجد مهام متأخرة.',
          en: late ? `${late} of them are past due.` : 'No overdue tasks.',
        },
        link: '/tasks',
      });
      continue;
    }

    const mine = digest.open.filter((t) => t.assigneeId === user.id);
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

async function checkInsights() {
  const app = await findOne('apps', (a) => a.id === 'insights');
  if (!app?.url || app.enabled === false) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let data;
  try {
    const response = await fetch(`${app.url.replace(/\/$/, '')}/api/overview`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
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
  const spend = typeof t.spend === 'number' ? Math.round(t.spend).toLocaleString('en-US') : null;
  const leads = t.crmLeads ?? null;

  // Only people who can open the app should hear about it.
  const users = await find('users', (u) => u.status !== 'disabled');
  for (const user of users) {
    const allowed = user.role === 'admin' || !Array.isArray(user.appIds) || user.appIds.includes('insights');
    if (!allowed || !can(user, PERMISSIONS.APPS_VIEW)) continue;

    await notifyAndRecord(user.id, {
      type: 'insights.updated',
      title: { ar: 'تحديث جديد في التسويق والمبيعات', en: 'Insights Hub has new data' },
      body: {
        ar: spend ? `الإنفاق ${spend} · العملاء المحتملون ${leads ?? '—'}` : 'تم تحديث البيانات.',
        en: spend ? `Spend ${spend} · leads ${leads ?? '—'}` : 'The data has been refreshed.',
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
      `Insights checked every ${INSIGHTS_POLL_MINUTES} min`
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
    } catch (err) {
      console.error('[scheduler]', err);
    }
  };

  const timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  tick();
}
