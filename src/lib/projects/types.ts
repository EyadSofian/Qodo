/**
 * Qodo Projects — the shapes the browser works with.
 *
 * Mirrors what `server/projects/projectService.js` returns, in camelCase. The
 * server owns the column names; nothing here should ever be a snake_case key,
 * because that is the sign that a raw row escaped a service.
 */

/** Which tab of the projects list is being asked for. A closed set — see the server. */
export type ProjectScope = 'active' | 'archived' | 'trashed' | 'all';

export type ProjectAccess = 'private' | 'portal';

export type ProjectMemberRole = 'owner' | 'manager' | 'member' | 'viewer' | 'client';

export type BillingMethod =
  | 'none'
  | 'fixed_cost'
  | 'based_on_project_hours'
  | 'based_on_staff_hours'
  | 'based_on_task_hours';

export interface Project {
  id: string;
  /** The readable prefix — `ET` in `ET-42`. Set at creation and never changed. */
  key: string;
  name: string;
  description: string;
  ownerId: string;
  customerId: string | null;
  customerName: string | null;
  groupId: string | null;
  /** Groups are named bilingually, like departments — the reader's language is not known at write time. */
  groupName: { ar: string; en: string } | null;
  statusId: string | null;
  startDate: string | null;
  endDate: string | null;
  access: ProjectAccess;
  currency: string;
  billingMethod: BillingMethod;
  color: string;
  memberCount: number;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember {
  userId: string;
  role: ProjectMemberRole;
  projectRoleId: string | null;
  isClient: boolean;
  allocationPercent: number;
  addedAt: string;
  addedBy: string | null;
}

/** What `contextFor` resolved for the current person — the browser's copy. */
export interface ProjectMembership {
  role: ProjectMemberRole;
  isClient: boolean;
  allocation: number;
  /**
   * Set when the membership was not an explicit row: `portal` for a project the
   * organization opened to staff, `admin` for a workspace administrator. Shown
   * in the UI so somebody who has access without being a member knows why.
   */
  implicit?: 'portal' | 'admin';
}

export interface ProjectDetail {
  project: Project;
  membership: ProjectMembership;
  /**
   * What this person may do. Used only to hide what would be refused — the
   * server re-checks every one of these on every request.
   */
  permissions: string[];
  isClient: boolean;
}

export interface ProjectPage {
  projects: Project[];
  total: number;
  limit: number;
  offset: number;
}

/** One row of the append-only audit log, as the activity feed reads it. */
export interface ProjectActivityEvent {
  id: string;
  actor_id: string | null;
  source: string;
  entity_type: string;
  entity_id: string;
  action: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  occurred_at: string;
}

export interface ProjectListQuery {
  scope?: ProjectScope;
  /** `mine` and `favorites` resolve to the session user on the server, never to an id from here. */
  mine?: boolean;
  favorites?: boolean;
  groupId?: string;
  customerId?: string;
  statusId?: string;
  ownerId?: string;
  q?: string;
  sort?: 'name' | 'key' | 'created' | 'updated' | 'start' | 'end';
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ProjectInput {
  name: string;
  key?: string;
  description?: string;
  ownerId?: string;
  customerId?: string | null;
  groupId?: string | null;
  statusId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  access?: ProjectAccess;
  currency?: string;
  billingMethod?: BillingMethod;
  color?: string;
}

/* ------------------------------------------------------------------ */
/* Work breakdown                                                       */
/* ------------------------------------------------------------------ */

/**
 * A status, as any module's records carry it.
 *
 * `category` is what the product branches on — a company's "Awaiting client
 * sign-off" is a review state whatever it is called, and nothing in the UI is
 * allowed to hardcode a status *name*.
 */
export interface WorkStatus {
  key: string;
  label: { ar: string; en: string };
  color: string;
  category: 'open' | 'active' | 'review' | 'done' | 'cancelled';
}

export interface Phase {
  id: string;
  name: string;
  description: string;
  ownerId: string | null;
  statusId: string | null;
  status: WorkStatus | null;
  startDate: string | null;
  endDate: string | null;
  /** False means internal — a client user never receives this row at all. */
  isExternal: boolean;
  sequence: number;
  color: string;
  taskCount: number;
  doneCount: number;
  /** Rolled up from the phase's own tasks, never typed by hand. */
  progress: number;
  estimatedHours: number;
  actualHours: number;
  createdAt: string;
  updatedAt: string;
}

export type BillingType = 'none' | 'billable' | 'non_billable';

export interface TaskList {
  id: string;
  name: string;
  description: string;
  phaseId: string | null;
  phaseName: string | null;
  isExternal: boolean;
  billingType: BillingType;
  orderIndex: number;
  color: string;
  taskCount: number;
  doneCount: number;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export type ContributorKind = 'assignee' | 'contributor' | 'reviewer' | 'approver' | 'follower';

export interface TaskContributor {
  userId: string;
  kind: ContributorKind;
}

export interface ChecklistItem {
  id: string;
  text: string;
  isDone: boolean;
  /** An open required item blocks completion — enforced on the server. */
  isRequired: boolean;
  orderIndex: number;
  doneAt?: string | null;
  doneBy?: string | null;
}

/**
 * A project task: one Qodo task document plus its project extension.
 *
 * The first block is inherited whole from the workspace — including the
 * two-sided review contract, which Projects does not reimplement. The second is
 * what being in a project adds.
 */
export interface ProjectTask {
  id: string;
  reference: string;
  title: string;
  description: string;
  objective: string;
  definitionOfDone: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  labels: string[];

  /* the Qodo contract */
  department: string;
  stage: string;
  assigneeIds: string[];
  createdBy: string;
  dueDate: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewDecision: 'approved' | 'changes_requested' | null;
  reworkCount: number;
  completedAt: string | null;
  attachmentCount: number;

  /* what the project adds */
  projectId: string;
  phaseId: string | null;
  phaseName: string | null;
  taskListId: string | null;
  taskListName: string | null;
  parentTaskId: string | null;
  depth: number;
  orderIndex: number;
  statusId: string | null;
  status: WorkStatus | null;
  progress: number;
  startDate: string | null;
  endDate: string | null;
  durationDays: number;
  estimatedHours: number | null;
  actualHours: number;
  remainingHours: number | null;
  billingType: BillingType;
  isBillable: boolean;
  color: string | null;

  childCount: number;
  /**
   * Always the summary, on every endpoint. It used to be the item array on a
   * single-task read and the summary in a listing, and one name meaning two
   * shapes is what let a task be completed with an unticked mandatory item.
   */
  checklist: { total: number; done: number; requiredOpen: number };
  /** The items themselves. Only present when a single task was fetched. */
  checklistItems?: ChecklistItem[];
  contributors: TaskContributor[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskPage {
  tasks: ProjectTask[];
  total: number;
  limit: number;
  offset: number;
}

export interface TaskQuery {
  phaseId?: string;
  taskListId?: string;
  statusId?: string;
  parentTaskId?: string;
  topLevel?: boolean;
  overdue?: boolean;
  mine?: boolean;
  assigneeId?: string;
  sort?: 'order' | 'due' | 'start' | 'created' | 'updated' | 'progress';
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface PhaseInput {
  name: string;
  description?: string;
  ownerId?: string | null;
  statusId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  isExternal?: boolean;
  color?: string;
}

export interface TaskListInput {
  name: string;
  description?: string;
  phaseId?: string | null;
  isExternal?: boolean;
  billingType?: BillingType;
  color?: string;
}

export interface TaskInput {
  title: string;
  description?: string;
  objective?: string;
  definitionOfDone?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  phaseId?: string | null;
  taskListId?: string | null;
  parentTaskId?: string | null;
  statusId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  durationDays?: number;
  estimatedHours?: number | null;
  assigneeIds?: string[];
  billingType?: BillingType;
  isBillable?: boolean;
  labels?: string[];
}

/** A person who could be added to a project — what a picker needs, nothing more. */
export interface MemberCandidate {
  id: string;
  name: string;
  email: string;
  title: string | null;
  department: string;
  avatarColor: string;
}

/* ------------------------------------------------------------------ */
/* Schedule                                                             */
/* ------------------------------------------------------------------ */

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface TaskDependency {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  /** Working days, not calendar days — like every duration in this product. */
  lagDays: number;
}

/** One task as the scheduler computed it. Dates are `YYYY-MM-DD`. */
export interface ScheduledTask {
  id: string;
  durationDays: number;
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  /** Working days this task may slip without moving the project's end. */
  totalFloat: number;
  isCritical: boolean;
}

export type ProjectSchedule =
  | {
      ok: true;
      projectStart: string;
      projectFinish: string;
      tasks: ScheduledTask[];
      criticalPath: string[];
    }
  | { ok: false; error: 'cycle'; cycle: string[] | null; tasks: [] };

export interface RescheduleResult {
  ok: boolean;
  error?: string;
  cycle?: string[] | null;
  changes: Array<{
    id: string;
    from: { startDate: string | null; endDate: string | null };
    to: { startDate: string | null; endDate: string | null };
    isCritical: boolean;
  }>;
  projectFinish?: string;
  /** How far the project's own end moved. Positive is later. */
  projectSlipDays?: number | null;
  committed?: boolean;
}

export interface ProjectBaseline {
  id: string;
  name: string;
  notes: string;
  captured_at: string;
  captured_by: string | null;
}

export interface BaselineVariance {
  id: string;
  isNew: boolean;
  /** Positive is late. `null` when there is nothing to compare against. */
  startVarianceDays: number | null;
  finishVarianceDays: number | null;
}

/* ------------------------------------------------------------------ */
/* Issues                                                               */
/* ------------------------------------------------------------------ */

export type IssueSeverity = 'cosmetic' | 'minor' | 'major' | 'critical' | 'blocker';
export type IssuePriority = 'low' | 'normal' | 'high' | 'urgent';
export type IssueReproducibility = 'always' | 'sometimes' | 'rarely' | 'unable' | 'not_tried';
export type IssueRelation = 'relates_to' | 'blocks' | 'blocked_by' | 'duplicates' | 'caused_by';

/** What the clock says about one issue. Absent when no policy matched it. */
export interface IssueSla {
  responseDueAt: string | null;
  resolutionDueAt: string | null;
  responseBreached: boolean;
  resolutionBreached: boolean;
  escalationLevel: number;
}

export interface IssueLink {
  id: string;
  linkedType: 'task' | 'issue';
  linkedId: string;
  relation: IssueRelation;
}

export interface Issue {
  id: string;
  /** `ENG-42` — the project prefix plus a per-project number. */
  key: string;
  number: number;
  title: string;
  description: string;
  reporterId: string;
  assigneeId: string | null;
  statusId: string | null;
  status: WorkStatus | null;
  priority: IssuePriority;
  severity: IssueSeverity;
  classification: string | null;
  reproducibility: IssueReproducibility | null;
  moduleAffected: string | null;
  affectedPhaseId: string | null;
  targetPhaseId: string | null;
  dueDate: string | null;
  resolution: string | null;
  /** Derived from the status category, never typed by hand. */
  closedAt: string | null;
  isExternal: boolean;
  sla: IssueSla | null;
  links?: IssueLink[];
  createdAt: string;
  updatedAt: string;
}

export interface IssuePage {
  issues: Issue[];
  total: number;
  limit: number;
  offset: number;
}

export interface IssueQuery {
  statusId?: string;
  severity?: IssueSeverity;
  priority?: IssuePriority;
  open?: boolean;
  mine?: boolean;
  reported?: boolean;
  q?: string;
  sort?: 'created' | 'updated' | 'due' | 'severity' | 'priority' | 'key';
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface IssueInput {
  title: string;
  description?: string;
  assigneeId?: string | null;
  statusId?: string | null;
  priority?: IssuePriority;
  severity?: IssueSeverity;
  classification?: string | null;
  reproducibility?: IssueReproducibility | null;
  moduleAffected?: string | null;
  affectedPhaseId?: string | null;
  targetPhaseId?: string | null;
  dueDate?: string | null;
  resolution?: string | null;
  isExternal?: boolean;
}

/* ------------------------------------------------------------------ */
/* Configuration                                                        */
/* ------------------------------------------------------------------ */

export interface StatusDefinition {
  id: string;
  key: string;
  moduleKey: string;
  label: { ar: string; en: string };
  color: string;
  category: 'open' | 'active' | 'review' | 'done' | 'cancelled';
  orderIndex: number;
  isActive: boolean;
  isDefault: boolean;
}

/* ------------------------------------------------------------------ */
/* Time and money                                                       */
/* ------------------------------------------------------------------ */

export interface RunningTimer {
  id: string;
  projectId: string | null;
  projectName: string | null;
  projectKey: string | null;
  entityType: 'task' | 'issue';
  entityId: string;
  startedAt: string;
  pausedAt: string | null;
  notes: string;
  isRunning: boolean;
  /** Banked time plus the current run, computed on read. */
  elapsedSeconds: number;
}

export interface TimeEntry {
  id: string;
  projectId: string;
  taskId: string | null;
  issueId: string | null;
  userId: string;
  timesheetId: string | null;
  logDate: string;
  hours: number;
  notes: string;
  isBillable: boolean;
  approvalStatus: 'draft' | 'submitted' | 'approved' | 'rejected';
  invoicedAt: string | null;
  /** Absent unless the reader holds `rate.view` — stripped by the projection. */
  billRate?: number | null;
  costRate?: number | null;
  createdAt: string;
}

export interface Timesheet {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string;
  lockedAt: string | null;
  hours?: number;
  entries?: number;
}

export type BudgetType =
  | 'project_hours'
  | 'staff_hours'
  | 'project_amount'
  | 'fixed_cost'
  | 'task_hours'
  | 'issue_hours';

export type BudgetState = 'unset' | 'healthy' | 'at_risk' | 'overrun' | 'surplus';

export interface Budget {
  id: string;
  projectId: string;
  phaseId: string | null;
  phaseName: string | null;
  type: BudgetType;
  amount: number | null;
  hours: number | null;
  currency: string;
  thresholdPercent: number;
  consumed: number | null;
  state: BudgetState;
  percent: number | null;
}

/**
 * What the project has spent and planned.
 *
 * Every figure may be `null`, and null is not zero: a project with no estimates
 * has no planned hours, and reporting zero would be a measurement nobody made.
 */
export interface Consumption {
  plannedHours: number | null;
  actualHours: number | null;
  approvedHours: number | null;
  billableHours: number | null;
  labourCost: number | null;
  billableAmount: number | null;
  expenses: number | null;
  actualCost: number | null;
  taskCount: number;
  doneCount: number;
  averageProgress: number | null;
}

export type EarnedValue =
  | {
      available: true;
      currency: string;
      budgetAtCompletion: number;
      plannedValue: number;
      earnedValue: number;
      actualCost: number;
      scheduleVariance: number;
      costVariance: number;
      schedulePerformanceIndex: number | null;
      costPerformanceIndex: number | null;
      estimateAtCompletion: number | null;
      estimateToComplete: number | null;
      progressPercent: number;
      plannedProgressPercent: number;
      /** How planned value was derived. Stated so nobody over-reads it. */
      plannedProgressBasis: string;
    }
  | {
      available: false;
      /** Exactly which inputs are absent — never computed around. */
      missing: string[];
      partial: {
        budgetAtCompletion: number | null;
        actualCost: number | null;
        progressPercent: number | null;
      };
    };
