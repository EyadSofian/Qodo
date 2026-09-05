/**
 * Qodo Projects — the typed API client.
 *
 * Rides the workspace's existing `api` wrapper, so the session cookie, the 401
 * handling and the error shape are all inherited rather than reimplemented.
 * Everything here is a thin, named call: no logic, because logic that lives in
 * a client is logic the server is not enforcing.
 */

import { ApiError, api } from '../api';
import type {
  BaselineVariance,
  ChecklistItem,
  Issue,
  IssueInput,
  IssueLink,
  IssuePage,
  IssueQuery,
  ContributorKind,
  Phase,
  PhaseInput,
  Project,
  ProjectActivityEvent,
  ProjectDetail,
  ProjectInput,
  ProjectListQuery,
  ProjectMember,
  ProjectMemberRole,
  MemberCandidate,
  DocumentFolder,
  ProjectBaseline,
  ProjectComment,
  ProjectDocument,
  ProjectPage,
  WikiPage,
  Portfolio,
  ProjectSchedule,
  ReportDefinition,
  ReportResult,
  SavedReport,
  WorkloadRow,
  ProjectTask,
  RescheduleResult,
  DependencyType,
  AutomationRule,
  AutomationRun,
  Budget,
  BudgetType,
  Consumption,
  EarnedValue,
  RunningTimer,
  IntegrationEntry,
  StatusDefinition,
  TimeEntry,
  Timesheet,
  WebhookEndpoint,
  TaskDependency,
  TaskInput,
  TaskList,
  TaskListInput,
  TaskPage,
  TaskQuery,
} from './types';

/**
 * Turn a query object into a string, dropping anything unset.
 *
 * Written out rather than reached for from a library because an `undefined`
 * that becomes the literal text "undefined" in a filter is a bug that looks
 * like an empty result — the sort of thing that gets diagnosed as "the server
 * lost my projects".
 */
function queryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    params.set(key, value === true ? '1' : String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

export const projectsApi = {
  list: (query: ProjectListQuery = {}) =>
    api.get<ProjectPage>(`/projects${queryString(query as Record<string, unknown>)}`),

  get: (projectId: string) => api.get<ProjectDetail>(`/projects/${projectId}`),

  create: (input: ProjectInput) => api.post<{ project: Project }>('/projects', input),

  update: (projectId: string, input: Partial<ProjectInput>) =>
    api.patch<{ project: Project }>(`/projects/${projectId}`, input),

  archive: (projectId: string) => api.post<{ project: Project }>(`/projects/${projectId}/archive`),
  unarchive: (projectId: string) => api.post<{ project: Project }>(`/projects/${projectId}/unarchive`),

  /** Moves to the recycle bin. `purge` is the one that does not come back. */
  remove: (projectId: string) => api.delete<{ project: Project }>(`/projects/${projectId}`),
  restore: (projectId: string) => api.post<{ project: Project }>(`/projects/${projectId}/restore`),
  purge: (projectId: string) => api.delete<{ purged: boolean }>(`/projects/${projectId}/purge`),

  favorite: (projectId: string, favorite: boolean) =>
    api.put<{ favorite: boolean }>(`/projects/${projectId}/favorite`, { favorite }),

  members: (projectId: string) => api.get<{ members: ProjectMember[] }>(`/projects/${projectId}/members`),

  /**
   * Who could be added. A Projects endpoint rather than the staff directory,
   * because adding a member must not require permission to read every user in
   * the company.
   */
  memberCandidates: (projectId: string) =>
    api.get<{ candidates: MemberCandidate[] }>(`/projects/${projectId}/members/candidates`),

  addMember: (projectId: string, userId: string, role: ProjectMemberRole, allocationPercent?: number) =>
    api.post<{ member: ProjectMember }>(`/projects/${projectId}/members`, {
      userId,
      role,
      allocationPercent,
    }),

  removeMember: (projectId: string, userId: string) =>
    api.delete<void>(`/projects/${projectId}/members/${userId}`),

  activity: (projectId: string, limit = 50) =>
    api.get<{ events: ProjectActivityEvent[] }>(
      `/projects/${projectId}/activity${queryString({ limit })}`
    ),
};

/* ------------------------------------------------------------------ */
/* Work breakdown                                                       */
/* ------------------------------------------------------------------ */

export const phasesApi = {
  list: (projectId: string, statusId?: string) =>
    api.get<{ phases: Phase[] }>(`/projects/${projectId}/phases${queryString({ statusId })}`),
  get: (projectId: string, phaseId: string) =>
    api.get<{ phase: Phase }>(`/projects/${projectId}/phases/${phaseId}`),
  create: (projectId: string, input: PhaseInput) =>
    api.post<{ phase: Phase }>(`/projects/${projectId}/phases`, input),
  update: (projectId: string, phaseId: string, input: Partial<PhaseInput>) =>
    api.patch<{ phase: Phase }>(`/projects/${projectId}/phases/${phaseId}`, input),
  remove: (projectId: string, phaseId: string) =>
    api.delete<{ deleted: boolean }>(`/projects/${projectId}/phases/${phaseId}`),
  /** A drag produces a whole new order, so the API takes the whole order. */
  reorder: (projectId: string, order: string[]) =>
    api.put<{ phases: Phase[] }>(`/projects/${projectId}/phases/reorder`, { order }),
};

export const taskListsApi = {
  list: (projectId: string, phaseId?: string | null) =>
    api.get<{ taskLists: TaskList[] }>(
      // `null` means "the lists filed against no phase", which is a different
      // question from "all of them" and needs a value the query string can hold.
      `/projects/${projectId}/task-lists${queryString({ phaseId: phaseId === null ? 'none' : phaseId })}`
    ),
  create: (projectId: string, input: TaskListInput) =>
    api.post<{ taskList: TaskList }>(`/projects/${projectId}/task-lists`, input),
  update: (projectId: string, taskListId: string, input: Partial<TaskListInput>) =>
    api.patch<{ taskList: TaskList }>(`/projects/${projectId}/task-lists/${taskListId}`, input),
  remove: (projectId: string, taskListId: string) =>
    api.delete<{ deleted: boolean }>(`/projects/${projectId}/task-lists/${taskListId}`),
  reorder: (projectId: string, order: string[]) =>
    api.put<{ taskLists: TaskList[] }>(`/projects/${projectId}/task-lists/reorder`, { order }),
};

export const projectTasksApi = {
  list: (projectId: string, query: TaskQuery = {}) =>
    api.get<TaskPage>(`/projects/${projectId}/tasks${queryString(query as Record<string, unknown>)}`),
  get: (projectId: string, taskId: string) =>
    api.get<{ task: ProjectTask }>(`/projects/${projectId}/tasks/${taskId}`),
  create: (projectId: string, input: TaskInput) =>
    api.post<{ task: ProjectTask }>(`/projects/${projectId}/tasks`, input),
  update: (projectId: string, taskId: string, input: Partial<TaskInput>) =>
    api.patch<{ task: ProjectTask }>(`/projects/${projectId}/tasks/${taskId}`, input),
  remove: (projectId: string, taskId: string) =>
    api.delete<{ deleted: boolean }>(`/projects/${projectId}/tasks/${taskId}`),

  reparent: (projectId: string, taskId: string, parentTaskId: string | null) =>
    api.put<{ task: ProjectTask }>(`/projects/${projectId}/tasks/${taskId}/parent`, { parentTaskId }),

  setAssignees: (projectId: string, taskId: string, userIds: string[], kind: ContributorKind = 'assignee') =>
    api.put<{ task: ProjectTask }>(`/projects/${projectId}/tasks/${taskId}/assignees`, { userIds, kind }),

  addChecklistItem: (projectId: string, taskId: string, text: string, isRequired = false) =>
    api.post<{ item: ChecklistItem }>(`/projects/${projectId}/tasks/${taskId}/checklist`, {
      text,
      isRequired,
    }),
  setChecklistItem: (
    projectId: string,
    taskId: string,
    itemId: string,
    input: Partial<Pick<ChecklistItem, 'text' | 'isDone' | 'isRequired'>>
  ) => api.patch<{ item: ChecklistItem }>(`/projects/${projectId}/tasks/${taskId}/checklist/${itemId}`, input),
  removeChecklistItem: (projectId: string, taskId: string, itemId: string) =>
    api.delete<void>(`/projects/${projectId}/tasks/${taskId}/checklist/${itemId}`),
};

/* ------------------------------------------------------------------ */
/* Schedule                                                             */
/* ------------------------------------------------------------------ */

export const scheduleApi = {
  /** The computed schedule. Read-only — it says what the dates *would* be. */
  get: (projectId: string) => api.get<ProjectSchedule>(`/projects/${projectId}/schedule`),

  dependencies: (projectId: string) =>
    api.get<{ dependencies: TaskDependency[] }>(`/projects/${projectId}/schedule/dependencies`),
  addDependency: (
    projectId: string,
    predecessorId: string,
    successorId: string,
    type: DependencyType = 'FS',
    lagDays = 0
  ) =>
    api.post<{ dependency: TaskDependency }>(`/projects/${projectId}/schedule/dependencies`, {
      predecessorId,
      successorId,
      type,
      lagDays,
    }),
  removeDependency: (projectId: string, dependencyId: string) =>
    api.delete<void>(`/projects/${projectId}/schedule/dependencies/${dependencyId}`),

  /**
   * Preview a move. Nothing is written — this is what lets a drag warn "this
   * pushes the project out by six working days" before it lands.
   */
  previewMove: (projectId: string, taskId: string, startDate: string) =>
    api.post<RescheduleResult>(`/projects/${projectId}/schedule/reschedule`, { taskId, startDate }),

  commitMove: (projectId: string, taskId: string, startDate: string) =>
    api.put<RescheduleResult>(`/projects/${projectId}/schedule/reschedule`, { taskId, startDate }),

  apply: (projectId: string) => api.put<ProjectSchedule>(`/projects/${projectId}/schedule/apply`, {}),

  baselines: (projectId: string) =>
    api.get<{ baselines: ProjectBaseline[] }>(`/projects/${projectId}/schedule/baselines`),
  captureBaseline: (projectId: string, name?: string, notes?: string) =>
    api.post<{ baseline: ProjectBaseline }>(`/projects/${projectId}/schedule/baselines`, { name, notes }),
  variance: (projectId: string, baselineId: string) =>
    api.get<{ variance: BaselineVariance[] }>(
      `/projects/${projectId}/schedule/baselines/${baselineId}/variance`
    ),
};

/* ------------------------------------------------------------------ */
/* Issues                                                               */
/* ------------------------------------------------------------------ */

export const issuesApi = {
  list: (projectId: string, query: IssueQuery = {}) =>
    api.get<IssuePage>(`/projects/${projectId}/issues${queryString(query as Record<string, unknown>)}`),
  get: (projectId: string, issueId: string) =>
    api.get<{ issue: Issue }>(`/projects/${projectId}/issues/${issueId}`),
  create: (projectId: string, input: IssueInput) =>
    api.post<{ issue: Issue }>(`/projects/${projectId}/issues`, input),
  update: (projectId: string, issueId: string, input: Partial<IssueInput>) =>
    api.patch<{ issue: Issue }>(`/projects/${projectId}/issues/${issueId}`, input),
  remove: (projectId: string, issueId: string) =>
    api.delete<{ deleted: boolean }>(`/projects/${projectId}/issues/${issueId}`),

  addLink: (projectId: string, issueId: string, linkedType: 'task' | 'issue', linkedId: string, relation?: string) =>
    api.post<{ link: IssueLink }>(`/projects/${projectId}/issues/${issueId}/links`, {
      linkedType,
      linkedId,
      relation,
    }),
  removeLink: (projectId: string, issueId: string, linkId: string) =>
    api.delete<void>(`/projects/${projectId}/issues/${issueId}/links/${linkId}`),
};

/* ------------------------------------------------------------------ */
/* Organization configuration                                           */
/* ------------------------------------------------------------------ */

export const projectSettingsApi = {
  statuses: (moduleKey?: string) =>
    api.get<{ statuses: StatusDefinition[] }>(`/projects/settings/statuses${queryString({ module: moduleKey })}`),
  modules: () => api.get<{ modules: unknown[] }>('/projects/settings/modules'),
};

/* ------------------------------------------------------------------ */
/* Time and money                                                       */
/* ------------------------------------------------------------------ */

export const timeApi = {
  startTimer: (projectId: string, entityType: 'task' | 'issue', entityId: string, notes?: string) =>
    api.post<{ timer: RunningTimer }>(`/projects/${projectId}/time/timer/start`, {
      entityType,
      entityId,
      notes,
    }),
  pauseTimer: (projectId: string) =>
    api.post<{ timer: RunningTimer }>(`/projects/${projectId}/time/timer/pause`),
  resumeTimer: (projectId: string) =>
    api.post<{ timer: RunningTimer }>(`/projects/${projectId}/time/timer/resume`),
  stopTimer: (projectId: string) =>
    api.post<{ entry: TimeEntry | null; discarded: boolean }>(`/projects/${projectId}/time/timer/stop`),

  entries: (projectId: string, query: { from?: string; to?: string; taskId?: string; userId?: string } = {}) =>
    api.get<{ entries: TimeEntry[]; total: number; totalHours: number; billableHours: number }>(
      `/projects/${projectId}/time/entries${queryString(query as Record<string, unknown>)}`
    ),
  log: (
    projectId: string,
    input: { taskId?: string; issueId?: string; hours: number; logDate?: string; notes?: string; isBillable?: boolean }
  ) => api.post<{ entry: TimeEntry }>(`/projects/${projectId}/time/entries`, input),
  updateEntry: (projectId: string, entryId: string, input: Partial<{ hours: number; logDate: string; notes: string; isBillable: boolean }>) =>
    api.patch<{ entry: TimeEntry }>(`/projects/${projectId}/time/entries/${entryId}`, input),
  deleteEntry: (projectId: string, entryId: string) =>
    api.delete<void>(`/projects/${projectId}/time/entries/${entryId}`),

  timesheet: (projectId: string, week?: string) =>
    api.get<{ timesheet: Timesheet; entries: TimeEntry[]; totalHours: number; billableHours: number }>(
      `/projects/${projectId}/time/timesheet${queryString({ week })}`
    ),
  submitTimesheet: (projectId: string, week?: string) =>
    api.post<{ timesheet: Timesheet }>(`/projects/${projectId}/time/timesheet/submit`, { week }),
  recallTimesheet: (projectId: string, timesheetId: string) =>
    api.post<{ timesheet: Timesheet }>(`/projects/${projectId}/time/timesheet/${timesheetId}/recall`),
  pendingTimesheets: (projectId: string) =>
    api.get<{ timesheets: Timesheet[] }>(`/projects/${projectId}/time/timesheet/pending`),
  reviewTimesheet: (projectId: string, timesheetId: string, decision: 'approved' | 'rejected', reason?: string) =>
    api.post<{ timesheet: Timesheet }>(`/projects/${projectId}/time/timesheet/${timesheetId}/review`, {
      decision,
      reason,
    }),
};

export const budgetApi = {
  status: (projectId: string) =>
    api.get<{ consumption: Consumption; budgets: Budget[] }>(`/projects/${projectId}/budget`),
  set: (projectId: string, input: { type: BudgetType; amount?: number | null; hours?: number | null; thresholdPercent?: number }) =>
    api.put<{ budget: Budget }>(`/projects/${projectId}/budget`, input),
  earnedValue: (projectId: string) =>
    api.get<EarnedValue>(`/projects/${projectId}/budget/earned-value`),
};

/* ------------------------------------------------------------------ */
/* Collaboration                                                        */
/* ------------------------------------------------------------------ */

export const commentsApi = {
  list: (projectId: string, entityType: string, entityId: string) =>
    api.get<{ comments: ProjectComment[] }>(`/projects/${projectId}/comments/${entityType}/${entityId}`),
  add: (projectId: string, entityType: string, entityId: string, body: string, isInternal = true) =>
    api.post<{ comment: ProjectComment }>(`/projects/${projectId}/comments/${entityType}/${entityId}`, {
      body,
      isInternal,
    }),
  edit: (projectId: string, commentId: string, body: string) =>
    api.patch<{ comment: ProjectComment }>(`/projects/${projectId}/comments/${commentId}`, { body }),
  remove: (projectId: string, commentId: string) =>
    api.delete<void>(`/projects/${projectId}/comments/${commentId}`),
  react: (projectId: string, commentId: string, emoji: string) =>
    api.put<{ added: boolean }>(`/projects/${projectId}/comments/${commentId}/reactions`, { emoji }),
};

export const pagesApi = {
  list: (projectId: string) => api.get<{ pages: WikiPage[] }>(`/projects/${projectId}/pages`),
  get: (projectId: string, pageId: string) =>
    api.get<{ page: WikiPage }>(`/projects/${projectId}/pages/${pageId}`),
  create: (projectId: string, input: { title: string; body?: string; isExternal?: boolean }) =>
    api.post<{ page: WikiPage }>(`/projects/${projectId}/pages`, input),
  update: (projectId: string, pageId: string, input: { title?: string; body?: string; isExternal?: boolean }) =>
    api.patch<{ page: WikiPage }>(`/projects/${projectId}/pages/${pageId}`, input),
};

/* ------------------------------------------------------------------ */
/* Documents                                                            */
/* ------------------------------------------------------------------ */

export const documentsApi = {
  list: (projectId: string, folderId?: string | null) =>
    api.get<{ files: ProjectDocument[] }>(
      `/projects/${projectId}/documents${queryString({ folderId: folderId === null ? 'none' : folderId })}`
    ),
  get: (projectId: string, fileId: string) =>
    api.get<{ file: ProjectDocument }>(`/projects/${projectId}/documents/${fileId}`),
  folders: (projectId: string) =>
    api.get<{ folders: DocumentFolder[] }>(`/projects/${projectId}/documents/folders`),
  createFolder: (projectId: string, name: string, isExternal = false) =>
    api.post<{ folder: DocumentFolder }>(`/projects/${projectId}/documents/folders`, { name, isExternal }),

  /**
   * Upload raw bytes with the metadata in headers.
   *
   * Not multipart, and not JSON: a `.json` document sent as a JSON body would
   * be eaten by the server's own body parser on the way in. Same shape the
   * workspace's existing `api.upload` uses.
   */
  upload: async (
    projectId: string,
    file: File,
    options: { fileId?: string; folderId?: string | null; isExternal?: boolean; notes?: string } = {}
  ) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
      'X-File-Type': file.type || 'application/octet-stream',
    };
    if (options.fileId) headers['X-File-Id'] = options.fileId;
    if (options.folderId) headers['X-Folder-Id'] = options.folderId;
    if (options.isExternal) headers['X-File-External'] = '1';
    if (options.notes) headers['X-File-Notes'] = options.notes;

    const response = await fetch(`/api/projects/${projectId}/documents`, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: file,
    });

    let payload: Record<string, unknown> = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (!response.ok) throw new ApiError(response.status, payload);
    return payload as { file: { id: string; name: string; versionNo: number } };
  },

  /**
   * Two steps on purpose: authorize once and get a token that expires, then
   * follow it. A link that leaks stops working (ADR-5).
   */
  downloadUrl: (projectId: string, fileId: string, versionNo?: number) =>
    api.post<{ url: string; expiresInSeconds: number }>(
      `/projects/${projectId}/documents/${fileId}/link`,
      { versionNo }
    ),

  restoreVersion: (projectId: string, fileId: string, versionNo: number) =>
    api.post<{ file: { versionNo: number } }>(
      `/projects/${projectId}/documents/${fileId}/versions/${versionNo}/restore`
    ),
  remove: (projectId: string, fileId: string) =>
    api.delete<void>(`/projects/${projectId}/documents/${fileId}`),
};

/* ------------------------------------------------------------------ */
/* Reports                                                              */
/* ------------------------------------------------------------------ */

export const reportsApi = {
  portfolio: (includeArchived = false) =>
    api.get<Portfolio>(`/projects/reports/portfolio${queryString({ includeArchived })}`),

  workload: (from?: string, to?: string) =>
    api.get<{ people: WorkloadRow[]; from: string | null; to: string | null }>(
      `/projects/reports/workload${queryString({ from, to })}`
    ),

  /** What the builder may offer — derived from the engine's own allowlists. */
  fields: (moduleKey: string, projectId?: string) =>
    api.get<{ groupings: string[]; measures: string[] }>(
      projectId
        ? `/projects/${projectId}/reports/fields${queryString({ module: moduleKey })}`
        : `/projects/reports/fields${queryString({ module: moduleKey })}`
    ),

  run: (definition: ReportDefinition, projectId?: string) =>
    api.post<ReportResult>(
      projectId ? `/projects/${projectId}/reports/run` : '/projects/reports/run',
      definition
    ),

  saved: (moduleKey?: string) =>
    api.get<{ reports: SavedReport[] }>(`/projects/reports/saved${queryString({ module: moduleKey })}`),

  save: (input: {
    name: string;
    module: string;
    definition: ReportDefinition;
    visibility?: string;
  }) => api.post<{ report: { id: string; name: string } }>('/projects/reports/saved', input),
};

/* ------------------------------------------------------------------ */
/* Administration                                                       */
/* ------------------------------------------------------------------ */

export const projectAdminApi = {
  statuses: (moduleKey?: string) =>
    api.get<{ statuses: StatusDefinition[] }>(
      `/projects/settings/statuses${queryString({ module: moduleKey })}`
    ),
  createStatus: (input: {
    module: string;
    key: string;
    labelAr: string;
    labelEn: string;
    color: string;
    category: string;
  }) => api.post<{ status: unknown }>('/projects/settings/statuses', input),
  updateStatus: (statusId: string, input: { labelAr?: string; labelEn?: string; color?: string; isActive?: boolean }) =>
    api.patch<{ status: unknown }>(`/projects/settings/statuses/${statusId}`, input),

  rules: (moduleKey = 'task') =>
    api.get<{ rules: AutomationRule[] }>(`/projects/settings/automation/rules${queryString({ module: moduleKey })}`),
  setRuleActive: (ruleId: string, isActive: boolean) =>
    api.put<{ rule: AutomationRule }>(`/projects/settings/automation/rules/${ruleId}/active`, { isActive }),
  runs: (limit = 50) =>
    api.get<{ runs: AutomationRun[] }>(`/projects/settings/automation/runs${queryString({ limit })}`),

  webhooks: () => api.get<{ endpoints: WebhookEndpoint[] }>('/projects/settings/webhooks'),
  createWebhook: (input: { name: string; url: string; events?: string[] }) =>
    // The one moment the secret is visible. It is never readable again.
    api.post<{ endpoint: { id: string; name: string; url: string; secret: string } }>(
      '/projects/settings/webhooks',
      input
    ),
  setWebhookActive: (endpointId: string, isActive: boolean) =>
    api.put<{ isActive: boolean }>(`/projects/settings/webhooks/${endpointId}/active`, { isActive }),

  integrations: () => api.get<{ integrations: IntegrationEntry[] }>('/projects/integrations'),
  connect: (input: { provider: string; credentials?: string; name?: string }) =>
    api.post<{ connection: { provider: string; status: string } }>('/projects/integrations', input),
  disconnect: (provider: string) => api.delete<void>(`/projects/integrations/${provider}`),
};
