/**
 * Qodo Assistant — the Projects tools.
 *
 * The assistant already knows about the workspace's tasks, apps and people.
 * These teach it about projects, and they are separate from
 * `server/assistant/tools.js` so that Projects can grow its own surface without
 * that file becoming the thing §72 warns about.
 *
 * Every tool resolves what the *signed-in user* may see before it reads
 * anything. An assistant that queries the database directly is a permission
 * bypass with a conversational interface, and it is the failure this file is
 * arranged to prevent — the tools call the same services the HTTP routes do,
 * with the same context.
 */

import { isAvailable } from '../projects/db.js';
import { visibleProjectIds } from '../projects/projectAccess.js';
import * as reports from '../projects/reportService.js';
import { rows } from '../projects/db.js';

/** What the model sees. */
export const PROJECT_TOOL_DEFINITIONS = [
  {
    name: 'list_projects',
    description:
      'List the projects the signed-in user is a member of or may otherwise see, with their status, ' +
      'dates and how much of the work is done. Call this when the user asks what projects exist, ' +
      'which are running, or for anything that needs a project name or id first.',
    input_schema: {
      type: 'object',
      properties: {
        onlyAtRisk: {
          type: 'boolean',
          description: 'Return only projects that are delayed, over budget, or carrying overdue work.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'project_health',
    description:
      'The portfolio picture: how many projects are at risk, how many are delayed, and how many tasks ' +
      'are overdue across all of them. Call this for "how are we doing", "what is at risk", ' +
      'or any question about the shape of the workload as a whole.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'project_overdue_work',
    description:
      'The tasks that are past their due date and not finished, across every project the user may see. ' +
      'Call this for "what is late", "what has slipped", or when asked what needs attention today.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Restrict to one project. Omit for all of them.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'project_workload',
    description:
      'Who is carrying how many assigned hours, and how much they have logged. Call this for ' +
      '"who is overloaded", "who has capacity", or when deciding who should take a new piece of work. ' +
      'Note that this measures hours, not a count of tasks.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/**
 * A guard every executor starts with.
 *
 * Projects needs a database, and without one the honest answer to the model is
 * that the module is unavailable — not an empty list, which it would report as
 * "you have no projects".
 */
function unavailable() {
  return {
    error:
      'The Projects module has no database configured, so I cannot read project data. ' +
      'This is a deployment setting, not a permissions problem.',
  };
}

const EXECUTORS = {
  async list_projects(input, user) {
    if (!isAvailable()) return unavailable();

    const portfolio = await reports.portfolio(user);
    const projects = input?.onlyAtRisk
      ? portfolio.projects.filter((project) => project.atRisk)
      : portfolio.projects;

    return {
      count: projects.length,
      projects: projects.slice(0, 40).map((project) => ({
        id: project.id,
        key: project.key,
        name: project.name,
        status: project.status,
        dueDate: project.endDate,
        tasksDone: project.doneCount,
        tasksTotal: project.taskCount,
        overdueTasks: project.overdueTasks,
        // Both words, because they mean different things and the model should
        // not have to infer one from the other.
        delayed: project.delayed,
        atRisk: project.atRisk,
      })),
    };
  },

  async project_health(_input, user) {
    if (!isAvailable()) return unavailable();

    const portfolio = await reports.portfolio(user);
    return {
      ...portfolio.summary,
      // Named so the model does not present a partial view as the whole
      // company's — it is the whole of what *this person* can see.
      scope: 'projects visible to the signed-in user',
      atRiskProjects: portfolio.projects
        .filter((project) => project.atRisk)
        .slice(0, 10)
        .map((project) => ({ name: project.name, overdueTasks: project.overdueTasks, delayed: project.delayed })),
    };
  },

  async project_overdue_work(input, user) {
    if (!isAvailable()) return unavailable();

    const projectIds = await visibleProjectIds(user);
    if (projectIds.length === 0) return { count: 0, tasks: [] };

    const scoped = input?.projectId
      ? projectIds.filter((id) => id === input.projectId)
      : projectIds;
    if (scoped.length === 0) return { count: 0, tasks: [] };

    const overdue = await rows(
      `SELECT t.task_id, t.end_date, t.progress, p.name AS project, p.key AS project_key
         FROM qodo_projects.project_task_extensions t
         JOIN qodo_projects.projects p ON p.id = t.project_id
         LEFT JOIN qodo_projects.statuses s ON s.id = t.status_id
        WHERE t.project_id = ANY($1::uuid[])
          AND t.deleted_at IS NULL
          AND t.end_date < CURRENT_DATE
          AND COALESCE(s.category, 'active') <> 'done'
        ORDER BY t.end_date
        LIMIT 40`,
      [scoped]
    );

    return {
      count: overdue.length,
      tasks: overdue.map((task) => ({
        id: task.task_id,
        project: task.project,
        dueDate: task.end_date,
        progressPercent: task.progress,
      })),
    };
  },

  async project_workload(_input, user) {
    if (!isAvailable()) return unavailable();

    const result = await reports.workload(user, {});
    return {
      people: result.people.slice(0, 30),
      // The caveat travels with the data, so the model does not turn "ten
      // tasks" into "overloaded".
      note: 'Measured in assigned hours. A task with no estimate contributes null, not zero.',
    };
  },
};

export async function runProjectTool(name, input, user) {
  const executor = EXECUTORS[name];
  if (!executor) return null;
  return executor(input ?? {}, user);
}

export const PROJECT_TOOL_LABELS = {
  list_projects: { ar: 'يراجع المشاريع', en: 'Checking the projects' },
  project_health: { ar: 'يقيس صحة المحفظة', en: 'Measuring portfolio health' },
  project_overdue_work: { ar: 'يبحث عن المتأخر', en: 'Looking for what is late' },
  project_workload: { ar: 'يوزّن أحمال الفريق', en: 'Weighing the team’s load' },
};

export const PROJECT_TOOL_SOURCES = {
  list_projects: { ar: 'المشاريع', en: 'Projects' },
  project_health: { ar: 'المشاريع', en: 'Projects' },
  project_overdue_work: { ar: 'مهام المشاريع', en: 'Project tasks' },
  project_workload: { ar: 'توزيع العمل', en: 'Workload' },
};
