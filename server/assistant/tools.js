/**
 * The assistant's tools.
 *
 * The model does not memorise the workspace — it reads it. Every answer about
 * tasks, people or apps comes from one of these functions running against the
 * live store at question time, which is why the assistant can say "3 overdue"
 * and still be right five minutes later.
 *
 * Every tool receives the signed-in user and re-checks their permissions. The
 * assistant is not a way around the access rules: team members stay inside
 * their department, and company-wide data remains administrator-only.
 */

import { create, find, findOne } from '../store.js';
import { PERMISSIONS, can, canOpenApp } from '../../shared/permissions.js';
import {
  DEFAULT_DEPARTMENT,
  DEPARTMENTS,
  DEPARTMENT_IDS,
  STAGE_TYPES,
  STAGE_TYPE_LABELS,
  departmentLabel,
  firstStage,
  getStage,
  getStages,
  isDoneStage,
  stageLabel,
  stageType,
} from '../../shared/departments.js';
import { logActivity } from '../auth.js';
import { notifyUser } from '../push.js';
import {
  canAssignUser,
  canManagePerformance,
  canUseDepartment,
  taskPredicate,
  visiblePeople,
} from '../taskAccess.js';
import { APP_DATA_EXECUTORS, APP_DATA_LABELS, APP_DATA_TOOLS } from './appData.js';

const PRIORITY_LABELS = {
  urgent: { ar: 'عاجلة', en: 'Urgent' },
  high: { ar: 'مهمة', en: 'High' },
  normal: { ar: 'عادية', en: 'Normal' },
  low: { ar: 'مؤجلة', en: 'Low' },
};

function daysUntil(dueDate) {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

const dept = (task) => task.department ?? DEFAULT_DEPARTMENT;

/** The tasks this user is allowed to see — same rule the board uses. */
async function visibleTasks(user) {
  return find('tasks', taskPredicate(user));
}

function taskScope(user) {
  if (can(user, PERMISSIONS.TASKS_VIEW_ALL)) return 'whole company';
  if (can(user, PERMISSIONS.TASKS_VIEW_TEAM)) return 'this team';
  return 'this user only';
}

async function nameOf(userId) {
  if (!userId) return null;
  const user = await findOne('users', (u) => u.id === userId);
  return user?.name ?? null;
}

async function shapeTask(task, lang) {
  const department = dept(task);
  return {
    id: task.id,
    title: task.title,
    description: task.description || null,
    department: departmentLabel(department, lang),
    stage: stageLabel(department, task.stage, lang),
    progress: STAGE_TYPE_LABELS[stageType(department, task.stage)][lang],
    priority: PRIORITY_LABELS[task.priority]?.[lang] ?? task.priority,
    assignee: await nameOf(task.assigneeId),
    createdBy: await nameOf(task.createdBy),
    dueDate: task.dueDate,
    daysUntilDue: daysUntil(task.dueDate),
    relatedApp: task.appId,
    completedAt: task.completedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Tool definitions — the shape the model sees                          */
/* ------------------------------------------------------------------ */

export const TOOL_DEFINITIONS = [
  {
    name: 'list_apps',
    description:
      'List the applications available in the Engosoft workspace, with what each one is for and its URL. ' +
      'Call this when the user asks which apps exist, where to find something, what a given dashboard does, ' +
      'or which app they should open for a particular question.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_departments',
    description:
      'List the workspace departments and the board stages each one uses. Call this before creating a task ' +
      'in a specific department, or when the user asks what a department\'s workflow looks like.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_tasks',
    description:
      'Search the workspace task board. Call this whenever the user asks about work items — what is late, ' +
      'what someone is working on, what is due this week, or to find a task by keyword. ' +
      'Returns only the tasks the signed-in user is permitted to see.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text matched against title, description and labels.' },
        department: {
          type: 'string',
          enum: DEPARTMENT_IDS,
          description: 'Restrict to one department.',
        },
        progress: {
          type: 'string',
          enum: STAGE_TYPES,
          description:
            'Restrict by how far along the work is, across departments: open, active, review or done.',
        },
        assigneeName: {
          type: 'string',
          description: 'Full or partial name of the person the task is assigned to.',
        },
        overdueOnly: { type: 'boolean', description: 'Only unfinished tasks whose due date has passed.' },
        dueWithinDays: { type: 'integer', description: 'Only tasks due within this many days from today.' },
        limit: { type: 'integer', description: 'Maximum tasks to return. Defaults to 25.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'task_summary',
    description:
      'Aggregate counts across the task board: how many at each progress level, how many overdue, how many ' +
      'finished in the last 7 days, plus per-person and per-department breakdowns. Call this for ' +
      '"how are we doing" style questions instead of listing every task.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_team',
    description:
      'List the people in the workspace with their department, role and job title. Call this to answer ' +
      'questions about who works here, or before assigning a task to confirm the exact name.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'create_task',
    description:
      'Create a new task on the board. Only call this when the user clearly asks to add or record a task. ' +
      'Confirm the title with the user first if their wording is ambiguous. Never invent an assignee or a ' +
      'due date the user did not give.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title, in the language the user used.' },
        description: { type: 'string', description: 'Optional detail.' },
        department: {
          type: 'string',
          enum: DEPARTMENT_IDS,
          description: "Department whose board it belongs on. Defaults to the user's own department.",
        },
        assigneeName: { type: 'string', description: 'Exact name of a person from list_team.' },
        dueDate: { type: 'string', description: 'Due date as YYYY-MM-DD.' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        appId: { type: 'string', description: 'Id of a related app from list_apps.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'recent_activity',
    description:
      'The workspace audit log — who created, changed or deleted what, most recent first. Call this for ' +
      '"what happened lately" or "who changed X" questions.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'How many entries. Defaults to 20.' } },
      additionalProperties: false,
    },
  },
  // Figures from inside the sibling dashboards — see ./appData.js.
  ...APP_DATA_TOOLS,
];

/* ------------------------------------------------------------------ */
/* Executors                                                            */
/* ------------------------------------------------------------------ */

const DENIED = {
  tasks: {
    ar: 'المستخدم لا يملك صلاحية الاطلاع على المهام.',
    en: 'This user does not have permission to view tasks.',
  },
  create: {
    ar: 'المستخدم لا يملك صلاحية إضافة المهام.',
    en: 'This user does not have permission to create tasks.',
  },
  activity: {
    ar: 'سجل الحركة متاح للمديرين فقط.',
    en: 'The activity log is available to managers only.',
  },
};

const EXECUTORS = {
  async list_apps(_input, user, lang) {
    const apps = await find('apps', (a) => a.enabled !== false);
    return {
      apps: apps
        .filter((a) => canOpenApp(user, a.id))
        .filter((a) => !a.requires || can(user, a.requires))
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
        .map((a) => ({
          id: a.id,
          name: lang === 'en' && a.nameEn ? a.nameEn : a.nameAr,
          about: a.descAr || null,
          url: a.url,
          openedInsideWorkspace: a.kind === 'internal',
        })),
    };
  },

  async list_departments(_input, user, lang) {
    const departments = can(user, PERMISSIONS.TASKS_VIEW_ALL)
      ? DEPARTMENTS
      : DEPARTMENTS.filter((department) => department.id === (user.department ?? DEFAULT_DEPARTMENT));
    return {
      departments: departments.map((d) => ({
        id: d.id,
        name: lang === 'en' ? d.en : d.ar,
        stages: d.stages.map((s) => ({
          id: s.id,
          name: lang === 'en' ? s.en : s.ar,
          progress: s.type,
        })),
      })),
    };
  },

  async search_tasks(input, user, lang) {
    if (!can(user, PERMISSIONS.TASKS_VIEW)) return { error: DENIED.tasks[lang] };

    let tasks = await visibleTasks(user);

    if (input.department) tasks = tasks.filter((t) => dept(t) === input.department);
    if (input.progress) tasks = tasks.filter((t) => stageType(dept(t), t.stage) === input.progress);

    if (input.query) {
      const term = String(input.query).toLowerCase();
      tasks = tasks.filter((t) =>
        `${t.title} ${t.description} ${(t.labels || []).join(' ')}`.toLowerCase().includes(term)
      );
    }

    if (input.assigneeName) {
      const term = String(input.assigneeName).toLowerCase();
      const matches = visiblePeople(
        user,
        await find(
          'users',
          (u) => u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)
        )
      );
      if (matches.length === 0) {
        return {
          tasks: [],
          note:
            lang === 'en'
              ? `Nobody matches "${input.assigneeName}".`
              : `لا يوجد شخص بهذا الاسم: «${input.assigneeName}».`,
        };
      }
      const ids = new Set(matches.map((u) => u.id));
      tasks = tasks.filter((t) => ids.has(t.assigneeId));
    }

    if (input.overdueOnly) {
      tasks = tasks.filter(
        (t) => !isDoneStage(dept(t), t.stage) && (daysUntil(t.dueDate) ?? 99999) < 0
      );
    }
    if (typeof input.dueWithinDays === 'number') {
      tasks = tasks.filter((t) => {
        const days = daysUntil(t.dueDate);
        return days !== null && days >= 0 && days <= input.dueWithinDays;
      });
    }

    // Soonest deadline first — that's the order a person would ask for.
    tasks.sort((a, b) => (daysUntil(a.dueDate) ?? 99999) - (daysUntil(b.dueDate) ?? 99999));

    const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 60);
    const page = tasks.slice(0, limit);

    return {
      totalMatching: tasks.length,
      returned: page.length,
      scope: taskScope(user),
      tasks: await Promise.all(page.map((t) => shapeTask(t, lang))),
    };
  },

  async task_summary(_input, user, lang) {
    if (!can(user, PERMISSIONS.TASKS_VIEW)) return { error: DENIED.tasks[lang] };

    const visible = await visibleTasks(user);
    const tasks = canManagePerformance(user)
      ? visible
      : visible.filter((task) => task.assigneeId === user.id);
    const open = tasks.filter((t) => !isDoneStage(dept(t), t.stage));
    const weekAgo = Date.now() - 7 * 86_400_000;

    const perPerson = {};
    const perDepartment = {};
    for (const task of open) {
      const overdue = (daysUntil(task.dueDate) ?? 99999) < 0;

      const person =
        (await nameOf(task.assigneeId)) ?? (lang === 'en' ? 'Unassigned' : 'غير مُسندة');
      perPerson[person] = perPerson[person] ?? { open: 0, overdue: 0 };
      perPerson[person].open += 1;
      if (overdue) perPerson[person].overdue += 1;

      const department = departmentLabel(dept(task), lang);
      perDepartment[department] = perDepartment[department] ?? { open: 0, overdue: 0 };
      perDepartment[department].open += 1;
      if (overdue) perDepartment[department].overdue += 1;
    }

    const byProgress = {};
    for (const type of STAGE_TYPES) {
      byProgress[STAGE_TYPE_LABELS[type][lang]] = tasks.filter(
        (t) => stageType(dept(t), t.stage) === type
      ).length;
    }

    return {
      scope: canManagePerformance(user) ? taskScope(user) : 'this user only',
      total: tasks.length,
      byProgress,
      overdue: open.filter((t) => (daysUntil(t.dueDate) ?? 99999) < 0).length,
      dueToday: open.filter((t) => daysUntil(t.dueDate) === 0).length,
      unassigned: open.filter((t) => !t.assigneeId).length,
      finishedLast7Days: tasks.filter(
        (t) => t.completedAt && new Date(t.completedAt).getTime() > weekAgo
      ).length,
      perPerson,
      perDepartment,
    };
  },

  async list_team(_input, user, lang) {
    // Without users.view a member still needs names to assign work — so they
    // get the directory (name, title, department), never roles or emails.
    const detailed = can(user, PERMISSIONS.USERS_VIEW);
    const users = visiblePeople(
      user,
      await find('users', (u) => u.status !== 'disabled')
    );
    return {
      detail: detailed ? 'full' : 'names_only',
      people: users.map((u) => {
        const base = {
          name: u.name,
          title: u.title,
          department: departmentLabel(u.department ?? DEFAULT_DEPARTMENT, lang),
        };
        return detailed
          ? {
              ...base,
              email: u.email,
              role: u.role,
              appsAllowed: u.appIds ? u.appIds.length : 'all',
              lastLoginAt: u.lastLoginAt,
            }
          : base;
      }),
    };
  },

  async create_task(input, user, lang) {
    if (!can(user, PERMISSIONS.TASKS_CREATE)) return { error: DENIED.create[lang] };

    const title = String(input.title || '').trim();
    if (!title) {
      return { error: lang === 'en' ? 'A task title is required.' : 'المهمة تحتاج عنواناً.' };
    }

    const department = DEPARTMENT_IDS.includes(input.department)
      ? input.department
      : (user.department ?? DEFAULT_DEPARTMENT);
    if (!canUseDepartment(user, department)) {
      return {
        error:
          lang === 'en'
            ? 'You can only create tasks for your own team.'
            : 'يمكنك إنشاء مهام لفريقك فقط.',
      };
    }

    let assigneeId = null;
    if (input.assigneeName) {
      const term = String(input.assigneeName).toLowerCase();
      const matches = await find(
        'users',
        (u) =>
          u.status !== 'disabled' &&
          (u.department ?? DEFAULT_DEPARTMENT) === department &&
          u.name.toLowerCase().includes(term)
      );
      if (matches.length === 0) {
        return {
          error:
            lang === 'en'
              ? `Nobody matches "${input.assigneeName}".`
              : `لا يوجد شخص بهذا الاسم: «${input.assigneeName}».`,
        };
      }
      if (matches.length > 1) {
        const names = matches.map((m) => m.name).join(lang === 'en' ? ', ' : '، ');
        return {
          error:
            lang === 'en'
              ? `That name matches more than one person: ${names}`
              : `الاسم يطابق أكثر من شخص: ${names}`,
        };
      }
      if (!canAssignUser(user, matches[0], department)) {
        return {
          error:
            lang === 'en'
              ? 'That person is not in the selected team.'
              : 'هذا الموظف ليس ضمن الفريق المحدد.',
        };
      }
      assigneeId = matches[0].id;
    }

    let dueDate = null;
    if (input.dueDate) {
      const date = new Date(input.dueDate);
      if (Number.isNaN(date.getTime())) {
        return { error: lang === 'en' ? 'The due date is not valid.' : 'تاريخ التسليم غير صالح.' };
      }
      dueDate = date.toISOString().slice(0, 10);
    }

    let appId = null;
    if (input.appId) {
      const app = await findOne('apps', (a) => a.id === input.appId);
      if (app) appId = app.id;
    }

    const stage = firstStage(department);
    const siblings = await find('tasks', (t) => t.department === department && t.stage === stage);
    const task = await create('tasks', {
      title,
      description: String(input.description || '').trim(),
      notes: '',
      taskDate: new Date().toISOString().slice(0, 10),
      department,
      subteam: user.department === department ? (user.subteam ?? null) : null,
      stage,
      priority: ['low', 'normal', 'high', 'urgent'].includes(input.priority)
        ? input.priority
        : 'normal',
      assigneeId,
      createdBy: user.id,
      dueDate,
      appId,
      labels: [],
      score: null,
      scoreBy: null,
      scoredAt: null,
      completedAt: isDoneStage(department, stage) ? new Date().toISOString() : null,
      order: Math.min(0, ...siblings.map((t) => t.order ?? 0)) - 1,
    });

    if (assigneeId && assigneeId !== user.id) {
      const title2 = { ar: 'مهمة جديدة مُسندة إليك', en: 'A new task is assigned to you' };
      await create('notifications', {
        userId: assigneeId,
        actorId: user.id,
        type: 'task.assigned',
        title: title2,
        body: task.title,
        link: `/tasks?task=${task.id}`,
        read: false,
      });
      await notifyUser(assigneeId, { title: title2, body: task.title, link: `/tasks?task=${task.id}` });
    }

    await logActivity({
      actorId: user.id,
      action: 'task.create',
      subject: 'task',
      subjectId: task.id,
      meta: { title: task.title, via: 'assistant' },
    });

    return { created: true, task: await shapeTask(task, lang) };
  },

  async recent_activity(input, user, lang) {
    if (!can(user, PERMISSIONS.USERS_VIEW)) return { error: DENIED.activity[lang] };

    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 60);
    const entries = (await find('activity'))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);

    return {
      activity: await Promise.all(
        entries.map(async (entry) => ({
          who: await nameOf(entry.actorId),
          action: entry.action,
          what: entry.meta?.name ?? entry.meta?.title ?? null,
          at: entry.createdAt,
        }))
      ),
    };
  },
};

/** Runs one tool call. Never throws — the model gets the error as a result. */
export async function runTool(name, input, user, lang = 'ar') {
  const executor = EXECUTORS[name] ?? APP_DATA_EXECUTORS[name];
  if (!executor) return { error: `Unknown tool: ${name}` };
  try {
    return await executor(input ?? {}, user, lang);
  } catch (err) {
    console.error(`[assistant] tool ${name} failed:`, err);
    return { error: 'That tool failed. Try a different phrasing of the question.' };
  }
}

/** Shown in the UI while each tool runs. */
export const TOOL_LABELS = {
  list_apps: { ar: 'يراجع تطبيقات المساحة', en: 'Checking the app registry' },
  list_departments: { ar: 'يراجع الأقسام ومراحلها', en: 'Checking departments and stages' },
  search_tasks: { ar: 'يبحث في المهام', en: 'Searching tasks' },
  task_summary: { ar: 'يحسب أرقام اللوحة', en: 'Crunching board numbers' },
  list_team: { ar: 'يراجع أسماء الفريق', en: 'Checking the team directory' },
  create_task: { ar: 'يضيف المهمة', en: 'Creating the task' },
  recent_activity: { ar: 'يقرأ سجل الحركة', en: 'Reading the activity log' },
  ...APP_DATA_LABELS,
};

// Referenced by the system prompt builder for stage listings.
export { getStages };
