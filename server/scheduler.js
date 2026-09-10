/**
 * Scheduled notifications.
 *
 * User-facing jobs are deliberately bounded:
 *
 *   • a once-a-day digest of how much work each department is carrying
 *   • four management summaries at each configured brief time
 *
 * The Insights watcher sends one compact update whenever a new successful sync
 * is observed. Its stable push tag replaces the previous phone alert instead
 * of stacking duplicates; the four detailed briefs stay on their own schedule.
 *
 * Deliberately an in-process timer rather than a cron dependency — the same
 * choice the Insights Hub itself made. The cost is that a restart could re-fire
 * a job, so both persist their last run and check it before sending: a redeploy
 * at 9:05 must not send the morning digest twice.
 */

import { create, createIfAbsent, find, findOne, getStore } from "./store.js";
import { isAvailable as projectsAvailable } from "./projects/db.js";
import {
  dueEscalations as dueSlaEscalations,
  recordEscalation as recordSlaEscalation,
  sweepBreaches as sweepSlaBreaches,
} from "./projects/slaService.js";
import { budgetsCrossingThreshold } from "./projects/budgetService.js";
import * as projectNotifications from "./projects/notificationService.js";
import { notifyUser, pushConfigured } from "./push.js";
import { publishNotification } from "./notificationStream.js";
import { mailConfigured, renderEmail, sendMail } from "./mail.js";
import { assigneesOf, isAssignee, taskState } from "../shared/workflow.js";
import { PERMISSIONS, can, isActiveUser } from "../shared/permissions.js";
import {
  DEFAULT_DEPARTMENT,
  DEPARTMENTS,
  isSettledStage,
} from "../shared/departments.js";
import { organizationOf } from "../shared/organization.js";

import { remindDueSoon } from "./management.js";
import { remindUpcomingEvents } from "./calendar.js";
import { generateHROperations } from "./hrOperations.js";
import {
  buildInsightsBriefNotifications,
  fetchInsightsBriefData,
  latestDueBriefSlot,
  parseBriefTimes,
} from "./insightsBrief.js";

const TICK_MS = 60 * 1000;
const DIGEST_HOUR = Number(process.env.DIGEST_HOUR ?? 9);
const TIMEZONE = process.env.DIGEST_TIMEZONE || "Africa/Cairo";
const INSIGHTS_POLL_MINUTES = Number(process.env.INSIGHTS_POLL_MINUTES ?? 30);
const INSIGHTS_BRIEF_TIMES = parseBriefTimes(
  process.env.INSIGHTS_BRIEF_TIMES || "11:30,19:00",
);
/** How far ahead a management item is warned about. */
const DESK_REMINDER_MINUTES = Number(
  process.env.MANAGEMENT_REMINDER_MINUTES ?? 60,
);

/* ── tiny persisted key/value ────────────────────────────────────── */

async function getSetting(key) {
  const row = await findOne("settings", (s) => s.id === key);
  return row?.value ?? null;
}

async function setSetting(key, value) {
  const store = await getStore();
  const existing = await findOne("settings", (s) => s.id === key);
  if (existing) await store.update("settings", key, { value });
  else await create("settings", { id: key, value });
}

function schedulerDays(lastDay, today, limit = 14) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(lastDay || "")) || lastDay >= today)
    return [today];
  const days = [];
  const cursor = new Date(`${lastDay}T00:00:00Z`);
  const end = new Date(`${today}T00:00:00Z`);
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    days.push(cursor.toISOString().slice(0, 10));
  }
  return days.slice(-limit);
}

/**
 * "Today" in the workspace's timezone, as YYYY-MM-DD. The server runs in UTC on
 * Railway, so a naive `new Date()` would roll the day over at the wrong moment
 * and fire the 9am digest in the middle of the night.
 */
function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

/* ── job 1: the daily digest ─────────────────────────────────────── */

const dept = (task) => task.department ?? DEFAULT_DEPARTMENT;

async function buildDigest(organizationId) {
  const tasks = await find(
    "tasks",
    (task) => organizationOf(task) === organizationId,
  );
  const open = tasks.filter((t) => !isSettledStage(dept(t), t.stage));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = (t) =>
    t.dueDate && new Date(`${t.dueDate}T00:00:00`).getTime() < today.getTime();

  const perDepartment = DEPARTMENTS.map((d) => {
    const mine = open.filter((t) => dept(t) === d.id);
    return {
      id: d.id,
      ar: d.ar,
      en: d.en,
      open: mine.length,
      overdue: mine.filter(isOverdue).length,
    };
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
  const users = await find("users", isActiveUser);
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
          ar: ` · مهامك أنت: ${own.length}${ownLate ? ` (${ownLate} متأخرة)` : ""}`,
          en: ` · Yours: ${own.length}${ownLate ? ` (${ownLate} late)` : ""}`,
        }
      : { ar: "", en: "" };

    // Administrators see the company picture. Team managers get their
    // department only; everyone else gets their own workload.
    if (can(user, PERMISSIONS.TASKS_VIEW_ALL)) {
      if (digest.totalOpen === 0) continue;

      const lines = digest.perDepartment
        .slice(0, 5)
        .map(
          (d) =>
            `${d.ar}: ${d.open}${d.overdue ? ` (${d.overdue} متأخرة)` : ""}`,
        );
      const linesEn = digest.perDepartment
        .slice(0, 5)
        .map(
          (d) => `${d.en}: ${d.open}${d.overdue ? ` (${d.overdue} late)` : ""}`,
        );

      await notifyAndRecord(user.id, {
        type: "digest.daily",
        title: {
          ar: `ملخص اليوم — ${digest.totalOpen} مهمة مفتوحة`,
          en: `Today — ${digest.totalOpen} open task${digest.totalOpen === 1 ? "" : "s"}`,
        },
        body: {
          ar: lines.join(" · ") + ownLine.ar,
          en: linesEn.join(" · ") + ownLine.en,
        },
        link: "/tasks",
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
        type: "digest.daily",
        title: {
          ar: `${label?.ar ?? "فريقك"} — ${team.length} مهمة مفتوحة`,
          en: `${label?.en ?? "Your team"} — ${team.length} open task${team.length === 1 ? "" : "s"}`,
        },
        body: {
          ar:
            (late ? `منها ${late} متأخرة عن موعدها.` : "لا توجد مهام متأخرة.") +
            ownLine.ar,
          en:
            (late ? `${late} of them are past due.` : "No overdue tasks.") +
            ownLine.en,
        },
        link: "/tasks",
      });
      continue;
    }

    const mine = digest.open.filter((t) => isAssignee(user, t));
    if (mine.length === 0) continue;
    const late = mine.filter(digest.isOverdue).length;

    await notifyAndRecord(user.id, {
      type: "digest.daily",
      title: {
        ar: `لديك ${mine.length} مهمة مفتوحة اليوم`,
        en: `You have ${mine.length} open task${mine.length === 1 ? "" : "s"} today`,
      },
      body: {
        ar: late ? `منها ${late} متأخرة عن موعدها.` : "لا يوجد متأخر — أحسنت.",
        en: late
          ? `${late} of them are past their due date.`
          : "None overdue — nice.",
      },
      link: "/tasks",
    });
  }
}

/* ── job 2: the Insights Hub watcher ─────────────────────────────── */

/** First and last day of the month we are currently in, as `YYYY-MM-DD`. */
function monthBounds(date = new Date()) {
  const { day } = localParts(date);
  const [year, month] = day.split("-");
  const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${String(last).padStart(2, "0")}`,
  };
}

async function checkInsights() {
  const app = await findOne("apps", (a) => a.id === "insights");
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
      `${app.url.replace(/\/$/, "")}/api/overview?from=${from}&to=${to}`,
      { signal: controller.signal, headers: { Accept: "application/json" } },
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

  const previous = await getSetting("insights.lastSyncedAt");
  if (previous === syncedAt) return;
  await setSetting("insights.lastSyncedAt", syncedAt);

  // The first observation only establishes a baseline. Every later Insights
  // sync keeps the original throughout-the-day update the team already uses;
  // the four richer management summaries remain limited to 11:30 and 19:00.
  if (!previous) return;

  const totals = data.totals ?? {};
  const formatNumber = (value) =>
    typeof value === "number"
      ? Math.round(value).toLocaleString("en-US")
      : null;
  const spend = formatNumber(totals.spend);
  const revenue = formatNumber(totals.accountingRevenue ?? totals.revenue);
  const invoices =
    typeof totals.invoicedOrders === "number" ? totals.invoicedOrders : null;
  const monthName = new Intl.DateTimeFormat("ar-EG", {
    timeZone: TIMEZONE,
    month: "long",
  }).format(new Date());
  const summary = [
    revenue ? `الإيراد ${revenue} دولار` : null,
    spend ? `الإنفاق ${spend} دولار` : null,
    invoices !== null ? `${invoices} فاتورة` : null,
  ].filter(Boolean);

  const users = await find("users", isActiveUser);
  for (const user of users) {
    const allowed =
      user.role === "admin" ||
      !Array.isArray(user.appIds) ||
      user.appIds.includes("insights");
    if (!allowed || !can(user, PERMISSIONS.APPS_VIEW)) continue;

    await notifyAndRecord(user.id, {
      type: "insights.data_updated",
      title: `تحديث جديد في التسويق والمبيعات — ${monthName}`,
      body: summary.length
        ? `${summary.join("، ")}. اضغط لعرض أحدث الأرقام.`
        : "تم تحديث بيانات التسويق والمبيعات. اضغط لعرض أحدث الأرقام.",
      link: "/app/insights",
      pushViaPopup: true,
      tag: "insights-live-update",
    });
  }
}

/** Current calendar month through today, for the two scheduled summaries. */
function monthToDateBounds(day) {
  return { from: `${day.slice(0, 8)}01`, to: day };
}

/**
 * The 11:30 and 19:00 summaries are short, separate notifications. Each topic
 * can be understood from its title without opening one oversized mixed card.
 */
async function sendManagementInsightsBrief(slot, bounds) {
  const app = await findOne("apps", (candidate) => candidate.id === "insights");
  if (!app?.url || app.enabled === false) return null;

  const data = await fetchInsightsBriefData(app.url, bounds);
  const summaries = buildInsightsBriefNotifications({ ...data, ...bounds });
  if (summaries.length === 0) return null;

  const users = await find("users", isActiveUser);
  const deliveries = [];
  for (const user of users) {
    const allowed =
      user.role === "admin" ||
      !Array.isArray(user.appIds) ||
      user.appIds.includes("insights");
    // Employee rankings and management signals are supervisory data. Ordinary
    // members keep their existing alerts, but do not receive this new brief.
    if (
      !allowed ||
      !can(user, PERMISSIONS.APPS_VIEW) ||
      !can(user, PERMISSIONS.USERS_VIEW)
    ) {
      continue;
    }

    for (const summary of summaries) {
      const notificationId = `insights-management-brief:${slot}:${summary.key}:${user.id}`;
      deliveries.push(
        notifyAndRecordOnce(notificationId, user.id, {
          type: summary.type,
          // These are Arabic management updates, even if Qodo or the phone is
          // currently set to English. Proper names remain untouched source
          // identifiers, but labels never jump between two languages.
          title: summary.title.ar,
          body: summary.body.ar,
          // Keep only the opaque notification id in the URL. The signed-in
          // workspace resolves the stored context and hands it to the Hub.
          link: `/app/insights?notice=${encodeURIComponent(notificationId)}`,
          // A phone tap first lands on Qodo's compact live card. The explicit
          // action on that card then opens the right Hub report and Nexus.
          pushLink: `/?notice=${encodeURIComponent(notificationId)}`,
          tag: `insights-${summary.key}-${slot}`,
          context: {
            kind: "insights_brief",
            key: summary.key,
            from: bounds.from,
            to: bounds.to,
            slot,
          },
        }),
      );
    }
  }
  const results = await Promise.all(deliveries);
  return results.filter(Boolean).length;
}

/* ── shared delivery ─────────────────────────────────────────────── */

/** Writes the in-app notification and sends the push, so both stay in step. */
async function notifyAndRecord(
  userId,
  { type, title, body, link, pushViaPopup = false, tag },
) {
  const user = await findOne("users", (candidate) => candidate.id === userId);
  const row = await create("notifications", {
    organizationId: organizationOf(user),
    userId,
    type,
    title,
    body,
    link,
    read: false,
  });
  // The live stream is what turns a stored notification into the alert that
  // slides in while somebody is looking at the app. Without it a scheduled
  // notice only appears on the next page load, which for "this is late today"
  // is too late to be the point.
  publishNotification(userId, row.id);
  await notifyUser(userId, {
    title,
    body,
    link: pushViaPopup ? `/?notice=${encodeURIComponent(row.id)}` : link,
    tag,
  });
  return row;
}

/** Same delivery with a deterministic id, safe across two Railway instances. */
async function notifyAndRecordOnce(
  id,
  userId,
  { type, title, body, link, pushLink, tag, context },
) {
  const user = await findOne("users", (candidate) => candidate.id === userId);
  const result = await createIfAbsent("notifications", {
    id,
    organizationId: organizationOf(user),
    userId,
    type,
    title,
    body,
    link,
    ...(context ? { context } : {}),
    read: false,
  });
  if (!result.created) return null;
  publishNotification(userId, result.doc.id);
  await notifyUser(userId, { title, body, link: pushLink ?? link, tag });
  return result.doc;
}

/* ── job 3: work that has gone past its date ─────────────────────── */

/**
 * Tells each person, once per task, that something of theirs is now late.
 *
 * Once per task and not once per day is the whole design. A daily repeat of the
 * same five names is the definition of a notification people learn to swipe
 * away, and the morning digest already carries the running count — this exists
 * to mark the *transition*, which is the moment the news is actually new. The
 * stamp lives on the task rather than in a scheduler variable so a redeploy
 * cannot resend it, and moving a due date clears it, because a deadline pushed
 * to next week has to be able to go late again.
 */
async function remindOverdue() {
  const store = await getStore();
  const today = new Date().toISOString().slice(0, 10);
  const open = await find(
    "tasks",
    (task) =>
      !task.archivedAt &&
      task.dueDate &&
      task.dueDate < today &&
      taskState(task) !== "signed_off" &&
      !isSettledStage(task.department ?? DEFAULT_DEPARTMENT, task.stage),
  );

  const perUser = new Map();
  for (const task of open) {
    // A due date that moved forward invalidates the old warning.
    if (task.overdueNotifiedFor === task.dueDate) continue;
    for (const userId of assigneesOf(task)) {
      if (!perUser.has(userId)) perUser.set(userId, []);
      perUser.get(userId).push(task);
    }
    await store.update("tasks", task.id, { overdueNotifiedFor: task.dueDate });
  }

  let sent = 0;
  for (const [userId, tasks] of perUser) {
    const user = await findOne("users", (candidate) => candidate.id === userId);
    if (!isActiveUser(user)) continue;

    const first = tasks[0];
    const more = tasks.length - 1;
    await notifyAndRecord(userId, {
      type: "task.overdue",
      title: {
        ar:
          tasks.length === 1
            ? "مهمة عدّت ميعادها"
            : `${tasks.length} مهام عدّت ميعادها`,
        en:
          tasks.length === 1
            ? "A task is past its due date"
            : `${tasks.length} tasks are past due`,
      },
      body: {
        ar:
          more > 0
            ? `«${first.title}» و${more} غيرها.`
            : `«${first.title}» كان المفروض تخلص ${first.dueDate}.`,
        en:
          more > 0
            ? `“${first.title}” and ${more} more.`
            : `“${first.title}” was due ${first.dueDate}.`,
      },
      // One task deep-links to itself; several open the board filtered to late.
      link:
        tasks.length === 1 ? `/tasks?task=${first.id}` : "/tasks?scope=mine",
    });
    sent += 1;

    await emailOverdue(user, tasks);
  }
  return sent;
}

/**
 * The same news by email, for the person who has not opened the app.
 *
 * Silent when SMTP is unconfigured, and never allowed to fail the job: an
 * address that bounces must not stop the other ninety-nine people being told.
 */
async function emailOverdue(user, tasks) {
  if (!mailConfigured() || !user.email) return;

  const base = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
  const html = renderEmail({
    title: "عندك شغل عدّى ميعاده",
    intro: `${user.name}، المهام دي كان المفروض تخلص وهي لسه مفتوحة:`,
    rows: tasks.map((task) => ({
      title: task.title,
      meta: `كان ميعادها ${task.dueDate}`,
    })),
    actionLabel: "افتح البورد",
    actionUrl: base ? `${base}/tasks?scope=mine` : "",
    footer:
      "الرسالة دي اتبعتت مرة واحدة لكل مهمة أول ما عدّت ميعادها — مش هتتكرر كل يوم.",
  });

  await sendMail({
    to: user.email,
    subject:
      tasks.length === 1
        ? `مهمة متأخرة: ${tasks[0].title}`
        : `${tasks.length} مهام متأخرة`,
    text: tasks.map((task) => `- ${task.title} (${task.dueDate})`).join("\n"),
    html,
  });
}

/* ── the loop ────────────────────────────────────────────────────── */

let started = false;

/**
 * The Qodo Projects clocks: SLA breaches, escalations and budget thresholds.
 *
 * Every one of these marks its own state before announcing anything — a breach
 * records that it breached, a budget records that it warned — so running this
 * once a minute can never send the same alert twice. That is the same
 * discipline the HR generator follows above, and for the same reason: a
 * scheduler that repeats itself teaches people to ignore it.
 *
 * Never throws. Projects being unconfigured, or its database being briefly
 * unreachable, must not stop the digest, the HR clock or the calendar
 * reminders.
 */
async function runProjectClocks(organizationId) {
  if (!projectsAvailable()) return;

  try {
    const breaches = await sweepSlaBreaches(organizationId);
    const total = breaches.response.length + breaches.resolution.length;
    if (total) console.log(`[scheduler] ${total} SLA breach(es) recorded`);

    for (const escalation of await dueSlaEscalations(organizationId)) {
      await projectNotifications.events.slaBreached(organizationId, {
        issueId: escalation.issueId,
        issueKey: escalation.issueKey,
        title: escalation.title,
        projectId: escalation.projectId,
        level: escalation.level,
        notify: escalation.notify,
      });
      await recordSlaEscalation(escalation.issueId, escalation.level);
    }

    for (const crossing of await budgetsCrossingThreshold(organizationId)) {
      await projectNotifications.events.budgetThreshold(
        organizationId,
        crossing,
      );
      console.log(
        `[scheduler] budget ${crossing.state} on ${crossing.projectName} (${crossing.percent}%)`,
      );
    }
  } catch (error) {
    console.error("[scheduler:projects]", error.message);
  }
}

export function startScheduler() {
  if (started) return;
  started = true;

  /**
   * Push being off used to switch the whole scheduler off, which was wrong once
   * anything here reached somebody another way. The in-app bell and the live
   * alert are stored in our own database, and email is its own channel; none of
   * them needs a VAPID key. Only the push *delivery* inside `notifyUser` does,
   * and that already no-ops on its own.
   */
  console.log(
    `[scheduler] daily digest at ${DIGEST_HOUR}:00 ${TIMEZONE}; ` +
      `Insights checked every ${INSIGHTS_POLL_MINUTES} min; ` +
      `management brief at ${INSIGHTS_BRIEF_TIMES.map((clock) => `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`).join(", ")}; ` +
      `management reminders ${DESK_REMINDER_MINUTES} min ahead; ` +
      `push ${pushConfigured() ? "on" : "off"}, email ${mailConfigured() ? "on" : "off"}`,
  );

  let lastInsightsCheck = 0;

  const tick = async () => {
    try {
      const { day, hour, minute } = localParts();

      if (
        hour === DIGEST_HOUR &&
        (await getSetting("digest.lastSentDay")) !== day
      ) {
        // Stamp before sending: a crash mid-send must not cause a second full
        // round of notifications on the next tick.
        await setSetting("digest.lastSentDay", day);
        await sendDigest();
        console.log(`[scheduler] daily digest sent for ${day}`);

        // Same hour as the digest, and deliberately not its own schedule: two
        // separate notifications about the same backlog arriving hours apart is
        // how a person learns to ignore both.
        const late = await remindOverdue();
        if (late) console.log(`[scheduler] ${late} overdue notice(s) sent`);
      }

      if (Date.now() - lastInsightsCheck >= INSIGHTS_POLL_MINUTES * 60 * 1000) {
        lastInsightsCheck = Date.now();
        await checkInsights();
      }

      const lastBriefSlot = await getSetting(
        "insights.managementBrief.lastSentSlot",
      );
      const briefSlot = latestDueBriefSlot({
        day,
        hour,
        minute,
        times: INSIGHTS_BRIEF_TIMES,
        lastSlot: lastBriefSlot,
      });
      if (briefSlot) {
        const sent = await sendManagementInsightsBrief(
          briefSlot,
          monthToDateBounds(day),
        );
        // A null result means all useful Insights data was unavailable, so the
        // next minute retries. Zero is a valid result when no manager is active.
        if (sent !== null) {
          await setSetting("insights.managementBrief.lastSentSlot", briefSlot);
          console.log(
            `[scheduler] management Insights brief ${briefSlot}: ${sent} recipient(s)`,
          );
        }
      }

      // Every tick, because a meeting an hour away is only useful news for the
      // hour before it. The item itself records that it has been warned about,
      // so running this a minute later never sends the same reminder twice.
      for (const organization of await find("organizations")) {
        // Recurring task creation is retried deliberately. Each occurrence has
        // a deterministic id, so running once a minute or catching up after a
        // short outage can never duplicate the obligation.
        const hrSetting = `hr.recurring.lastRunDay.${organization.id}`;
        const lastHRDay = await getSetting(hrSetting);
        let generated = 0;
        for (const runDay of schedulerDays(lastHRDay, day)) {
          const result = await generateHROperations({
            organizationId: organization.id,
            onDate: runDay,
          });
          generated += result.created.length;
        }
        await setSetting(hrSetting, day);
        if (generated)
          console.log(
            `[scheduler] ${generated} recurring HR task(s) generated`,
          );

        const sent = await remindDueSoon(
          organization.id,
          DESK_REMINDER_MINUTES,
        );
        if (sent)
          console.log(`[scheduler] ${sent} management reminder(s) sent`);

        // Each calendar entry carries its own lead time, so unlike the desk
        // there is no window to pass in — the entry says whether it is due to
        // warn its people yet, and records that it did.
        const called = await remindUpcomingEvents(organization.id);
        if (called)
          console.log(`[scheduler] ${called} calendar reminder(s) sent`);

        await runProjectClocks(organization.id);
      }
    } catch (err) {
      console.error("[scheduler]", err);
    }
  };

  const timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  tick();
}
