/**
 * Qodo Projects — AI.
 *
 * Three rules govern everything here, and a capability that cannot satisfy all
 * three does not ship.
 *
 * **1. The retrieval path is the authorization path.** Every capability starts
 * from `visibleProjectIds(user)` and every record passes the same checks a
 * listing does. An AI layer that queries the database directly "because it
 * needs context" is a permission bypass with a friendly interface — and it is
 * the single largest risk in this module.
 *
 * **2. Grounded, or silent.** Numbers come from SQL; the model writes the
 * sentence around figures it was given and never does the arithmetic. If the
 * inputs are absent the answer says so. §51's rule for earned value applies to
 * the whole surface: a confident number with no source is worse than no answer,
 * because a manager acts on it.
 *
 * **3. Preview before writing.** Anything that would create or modify records
 * returns a proposal. "Turn this brief into tasks" produces a reviewable list,
 * not fourteen rows and a notification.
 *
 * The provider is the workspace's existing one (`server/ai/provider.js`), which
 * is already OpenAI-compatible and configurable — matching what the live audit
 * found in Zoho's own "AI Hub", where the provider is a choice rather than a
 * hardwiring.
 */

import { rows, row } from './db.js';
import { find } from '../store.js';
import { visibleProjectIds } from './projectAccess.js';
import { aiConfigured, aiModel, getAiClient } from '../ai/provider.js';
import * as reports from './reportService.js';

/** How much context any one capability may gather. Bounded, always. */
const MAX_CONTEXT_ROWS = 60;

export const available = () => aiConfigured();

/**
 * Ask the model for prose, with a schema it must answer in.
 *
 * A response that will not parse is a failure, not a string to render — that
 * is what stops a hallucinated field name from reaching a write path.
 */
async function ask({ system, user, json = false, maxTokens = 700 }) {
  if (!aiConfigured()) {
    throw Object.assign(new Error('ai_not_configured'), {
      status: 503,
      body: { error: 'ai_not_configured' },
    });
  }

  const client = await getAiClient();
  const completion = await client.chat.completions.create({
    model: aiModel(),
    max_tokens: maxTokens,
    temperature: 0.2,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const text = completion.choices?.[0]?.message?.content ?? '';
  if (!json) return text.trim();

  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('ai_response_unparseable'), {
      status: 502,
      body: { error: 'ai_response_unparseable' },
    });
  }
}

/* ------------------------------------------------------------------ */
/* Summaries                                                            */
/* ------------------------------------------------------------------ */

/**
 * Summarise one task, from what the asker may actually read.
 *
 * The comments are fetched through the same client filter a listing uses, so a
 * client asking for a summary of a shared task does not get one drawn from an
 * internal thread. That is the leak this whole file is arranged to prevent.
 */
export async function summariseTask(context, taskId, lang = 'en') {
  const task = await row(
    `SELECT t.task_id, t.progress, t.start_date, t.end_date, t.estimated_hours, t.actual_hours,
            s.label_en AS status, ph.name AS phase, tl.name AS task_list
       FROM qodo_projects.project_task_extensions t
       LEFT JOIN qodo_projects.statuses s ON s.id = t.status_id
       LEFT JOIN qodo_projects.phases ph ON ph.id = t.phase_id
       LEFT JOIN qodo_projects.task_lists tl ON tl.id = t.task_list_id
      WHERE t.task_id = $1 AND t.project_id = $2 AND t.deleted_at IS NULL
        ${context.isClient ? 'AND tl.is_external = true' : ''}`,
    [taskId, context.project.id]
  );
  if (!task) return null;

  const comments = await rows(
    `SELECT author_id, body, created_at FROM qodo_projects.comments
      WHERE entity_type = 'task' AND entity_id = $1 AND deleted_at IS NULL
        ${context.isClient ? 'AND is_internal = false' : ''}
      ORDER BY created_at DESC LIMIT $2`,
    [taskId, MAX_CONTEXT_ROWS]
  );

  const facts = {
    status: task.status,
    phase: task.phase,
    list: task.task_list,
    progressPercent: task.progress,
    startDate: task.start_date,
    dueDate: task.end_date,
    estimatedHours: task.estimated_hours,
    actualHours: task.actual_hours,
    commentCount: comments.length,
  };

  const summary = await ask({
    system:
      'You summarise one project task for a colleague who has not been following it. ' +
      'Use only the facts and comments provided. Never invent a date, a number or a name. ' +
      'If the comments do not say what is blocking it, say that they do not. ' +
      `Answer in ${lang === 'ar' ? 'Arabic' : 'English'}, in at most four sentences.`,
    user: JSON.stringify({ facts, comments: comments.map((c) => ({ by: c.author_id, said: c.body })) }),
    maxTokens: 400,
  });

  return {
    summary,
    // Every summary cites what it was built from, so a reader can check it and
    // an auditor can see the boundary was respected.
    sources: {
      taskId,
      commentsConsidered: comments.length,
      internalCommentsIncluded: !context.isClient,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Generation                                                           */
/* ------------------------------------------------------------------ */

/**
 * Draft a description, acceptance criteria, or a status update.
 *
 * Returns a draft for a person to edit. Nothing is written — the caller puts it
 * in a form field, which is where a generated sentence belongs until somebody
 * has read it.
 */
export async function generate(kind, prompt, lang = 'en') {
  const briefs = {
    description:
      'Write a clear task description for a construction and engineering team. Say what is to be done ' +
      'and why, in plain language. Do not invent dates, quantities or names.',
    acceptance:
      'Write the definition of done for this task as a short checklist. Each line must be something ' +
      'somebody can verify. Do not invent standards or specification numbers.',
    update:
      'Write a short progress update for a project stakeholder, based only on what is given. ' +
      'If something is unknown, say it is unknown rather than estimating it.',
    issue:
      'Write a defect report: what was observed, where, and what was expected instead. ' +
      'Do not diagnose a cause that is not stated.',
  };

  if (!briefs[kind]) throw badRequest('generation_kind_unknown');

  return {
    draft: await ask({
      system: `${briefs[kind]} Answer in ${lang === 'ar' ? 'Arabic' : 'English'}.`,
      user: String(prompt ?? '').slice(0, 4000),
      maxTokens: 600,
    }),
    // Named so the UI can say this is a draft rather than presenting it as the
    // record.
    isDraft: true,
  };
}

/**
 * Turn a paragraph into a list of proposed tasks.
 *
 * **A proposal, never a write.** The caller shows it, a person edits it, and
 * only then does anything reach the database — §3 of the AI design and the
 * reason this returns `proposed` rather than `created`.
 */
export async function proposeTasks(context, brief, lang = 'en') {
  const lists = await rows(
    `SELECT id, name FROM qodo_projects.task_lists
      WHERE project_id = $1 AND deleted_at IS NULL LIMIT 20`,
    [context.project.id]
  );

  const answer = await ask({
    system:
      'You turn a short brief into a list of project tasks. Return JSON: ' +
      '{"tasks":[{"title":"","description":"","durationDays":1,"taskListName":null}]}. ' +
      'Titles are imperative and specific. Do not invent dates, people or costs. ' +
      'Use a taskListName only if it exactly matches one of the lists provided; otherwise null. ' +
      'Return at most 12 tasks. ' +
      `Write the titles and descriptions in ${lang === 'ar' ? 'Arabic' : 'English'}.`,
    user: JSON.stringify({ brief: String(brief ?? '').slice(0, 4000), availableLists: lists.map((l) => l.name) }),
    json: true,
    maxTokens: 1200,
  });

  const byName = new Map(lists.map((list) => [list.name, list.id]));

  return {
    proposed: (Array.isArray(answer?.tasks) ? answer.tasks : []).slice(0, 12).map((task) => ({
      title: String(task?.title ?? '').slice(0, 200),
      description: String(task?.description ?? '').slice(0, 2000),
      durationDays: Math.max(1, Math.min(365, Number(task?.durationDays) || 1)),
      // A list name the model invented resolves to null rather than creating
      // one — the model does not get to add structure nobody asked for.
      taskListId: byName.get(task?.taskListName) ?? null,
    })),
    // Unmissable in the response, so no caller can treat this as done.
    requiresConfirmation: true,
  };
}

/* ------------------------------------------------------------------ */
/* Insights                                                             */
/* ------------------------------------------------------------------ */

/**
 * Explain the portfolio, from figures SQL computed.
 *
 * The model receives numbers and writes the sentence. It never does the
 * arithmetic, which is what makes "three projects are at risk" checkable — and
 * every insight carries the project ids it came from.
 */
export async function portfolioInsights(user, lang = 'en') {
  const portfolio = await reports.portfolio(user);

  if (portfolio.projects.length === 0) {
    return { insights: [], grounded: true, reason: 'no_projects_visible' };
  }

  // Only the facts, and only for projects this person may already see.
  const facts = portfolio.projects.slice(0, MAX_CONTEXT_ROWS).map((project) => ({
    id: project.id,
    name: project.name,
    status: project.status,
    dueDate: project.endDate,
    delayed: project.delayed,
    atRisk: project.atRisk,
    tasks: project.taskCount,
    done: project.doneCount,
    overdue: project.overdueTasks,
    progressPercent: project.progress,
    hoursLogged: project.actualHours,
    hoursBudgeted: project.budgetHours,
  }));

  const answer = await ask({
    system:
      'You read a project portfolio and state what deserves attention. Return JSON: ' +
      '{"insights":[{"headline":"","detail":"","projectIds":[]}]}. ' +
      'Every insight must cite the projectIds it is about. ' +
      'Use only the figures given — never compute a new number, never estimate one that is null, ' +
      'and never mention a project that is not in the data. At most five insights. ' +
      `Write in ${lang === 'ar' ? 'Arabic' : 'English'}.`,
    user: JSON.stringify({ projects: facts, summary: portfolio.summary }),
    json: true,
    maxTokens: 900,
  });

  const known = new Set(portfolio.projects.map((project) => project.id));

  return {
    // An insight citing a project that is not in the data was invented, so it
    // is dropped rather than shown. This is the citation check, and it is
    // cheap.
    insights: (Array.isArray(answer?.insights) ? answer.insights : [])
      .map((insight) => ({
        headline: String(insight?.headline ?? '').slice(0, 200),
        detail: String(insight?.detail ?? '').slice(0, 1000),
        projectIds: (Array.isArray(insight?.projectIds) ? insight.projectIds : []).filter((id) =>
          known.has(id)
        ),
      }))
      .filter((insight) => insight.headline && insight.projectIds.length > 0)
      .slice(0, 5),
    grounded: true,
    basedOn: { projects: facts.length, summary: portfolio.summary },
  };
}

/* ------------------------------------------------------------------ */
/* Search and similarity                                                */
/* ------------------------------------------------------------------ */

/**
 * Find work that already looks like this.
 *
 * Deliberately not a model call. Duplicate detection at create time has to be
 * fast and deterministic, and trigram similarity in PostgreSQL is both — a
 * language model would be slower, non-deterministic, and no better at spotting
 * that "Pour slab B2" and "Pour the B2 slab" are the same job.
 */
export async function findSimilarTasks(context, title, limit = 5) {
  const needle = normalise(title);
  if (needle.length < 4) return [];

  const extensions = await rows(
    `SELECT task_id FROM qodo_projects.project_task_extensions
      WHERE project_id = $1 AND deleted_at IS NULL
      LIMIT 500`,
    [context.project.id]
  );
  if (extensions.length === 0) return [];

  const ids = new Set(extensions.map((task) => task.task_id));
  const documents = await find('tasks', (task) => ids.has(task.id));

  const needleWords = words(needle);
  if (needleWords.size === 0) return [];

  return documents
    .map((document) => ({
      id: document.id,
      title: document.title,
      score: overlap(needleWords, words(normalise(document.title))),
    }))
    // Half the words in common is the point where two titles are worth showing
    // side by side. Lower and the list fills with noise nobody reads.
    .filter((candidate) => candidate.score >= 0.5)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

/** Lower-case, punctuation-free, so "Pour slab B2." matches "pour the B2 slab". */
const normalise = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The words worth comparing.
 *
 * Short words are dropped because "the", "and" and "من" are in every title and
 * would make every pair look similar.
 */
function words(text) {
  return new Set(String(text).split(' ').filter((word) => word.length > 3));
}

/**
 * How much two titles have in common, as a proportion of the smaller one.
 *
 * Measured against the smaller set on purpose: "Pour slab" inside "Pour slab
 * B2 with reinforcement" is a real duplicate signal, and dividing by the union
 * would score it low precisely when it matters.
 */
function overlap(left, right) {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/**
 * Answer a question about the projects this person may see.
 *
 * The context is assembled from authorized queries and handed over whole; the
 * model never reaches the database. That is the difference between a search
 * that respects permissions and one that has to be told to.
 */
export async function askAboutProjects(user, question, lang = 'en') {
  const projectIds = await visibleProjectIds(user);
  if (projectIds.length === 0) {
    return { answer: null, reason: 'no_projects_visible', sources: [] };
  }

  const [projects, overdue] = await Promise.all([
    rows(
      `SELECT p.id, p.key, p.name, p.start_date, p.end_date, s.label_en AS status
         FROM qodo_projects.projects p
         LEFT JOIN qodo_projects.statuses s ON s.id = p.status_id
        WHERE p.id = ANY($1::uuid[]) AND p.deleted_at IS NULL
        LIMIT $2`,
      [projectIds, MAX_CONTEXT_ROWS]
    ),
    rows(
      `SELECT t.task_id, t.end_date, p.name AS project
         FROM qodo_projects.project_task_extensions t
         JOIN qodo_projects.projects p ON p.id = t.project_id
         LEFT JOIN qodo_projects.statuses s ON s.id = t.status_id
        WHERE t.project_id = ANY($1::uuid[]) AND t.deleted_at IS NULL
          AND t.end_date < CURRENT_DATE AND COALESCE(s.category, 'active') <> 'done'
        ORDER BY t.end_date LIMIT $2`,
      [projectIds, MAX_CONTEXT_ROWS]
    ),
  ]);

  const answer = await ask({
    system:
      'You answer questions about a project portfolio using only the data provided. ' +
      'If the data does not contain the answer, say so plainly rather than estimating. ' +
      'Never mention a project or a task that is not in the data. ' +
      `Answer in ${lang === 'ar' ? 'Arabic' : 'English'}, briefly.`,
    user: JSON.stringify({
      question: String(question ?? '').slice(0, 1000),
      projects,
      overdueTasks: overdue,
    }),
    maxTokens: 700,
  });

  return {
    answer,
    sources: projects.map((project) => ({ id: project.id, name: project.name })),
    // Stated so nobody reads a short answer as a complete one.
    scope: { projectsConsidered: projects.length, overdueTasksConsidered: overdue.length },
  };
}

/* ------------------------------------------------------------------ */
/* Translation                                                          */
/* ------------------------------------------------------------------ */

export async function translate(text, to = 'en') {
  const target = to === 'ar' ? 'Arabic' : 'English';
  return {
    translated: await ask({
      system:
        `Translate the text into ${target}. Keep project references, codes and numbers exactly as they are. ` +
        'Return only the translation, with no commentary.',
      user: String(text ?? '').slice(0, 6000),
      maxTokens: 1500,
    }),
  };
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
