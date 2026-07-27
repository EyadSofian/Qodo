export type Role = 'admin' | 'manager' | 'member' | 'viewer';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type StageType = 'open' | 'active' | 'review' | 'done';
/** Where a task sits in the assign → deliver → review → approve cycle. */
export type TaskState = 'assigned' | 'working' | 'submitted' | 'approved';
export type ReviewDecision = 'approved' | 'changes_requested';
export type EmbedMode = 'auto' | 'iframe' | 'newtab' | 'internal';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'disabled';
  title: string | null;
  avatarColor: string;
  /** Department id from shared/departments.js — sets the default board. */
  department: string;
  /** Optional organisational branch inside the department (marketing tree). */
  subteam: string | null;
  /** Canonical job role inside the selected sub-team. */
  jobRole: string | null;
  /** `null` = inherit the role's defaults. An array is an explicit override. */
  permissions: string[] | null;
  /** `null` = every app. An array restricts the launcher to those ids. */
  appIds: string[] | null;
  effectivePermissions: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  title: string | null;
  avatarColor: string;
  department: string;
  subteam: string | null;
  jobRole: string | null;
  role: Role;
}

export interface WorkspaceApp {
  id: string;
  kind: 'internal' | 'external';
  nameAr: string;
  nameEn?: string;
  descAr?: string;
  url: string;
  repo?: string | null;
  icon: string;
  color: string;
  group: string;
  embed: EmbedMode;
  order: number;
  enabled: boolean;
  builtin?: boolean;
  requires?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  /** Which department's board this task lives on. */
  department: string;
  /** Optional branch inside the department, e.g. Creative or Performance. */
  subteam: string | null;
  /** Stage id, only meaningful within that department. */
  stage: string;
  priority: TaskPriority;
  assigneeId: string | null;
  createdBy: string;
  /** Business date shown in the task table. */
  taskDate: string;
  dueDate: string | null;
  notes: string;

  /* ── the lifecycle ──────────────────────────────────────────────
     Written only by the workflow endpoints, never by the edit form. */

  startedAt: string | null;
  /** Set when the assignee hands the work in; cleared if it is sent back. */
  submittedAt: string | null;
  submittedBy: string | null;
  /** What the assignee said they delivered. */
  submissionNote: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  /** The manager's written verdict. Private, like the score. */
  reviewNote: string;
  reviewDecision: ReviewDecision | null;
  /** How many times a manager sent the work back. */
  reworkCount: number;
  /** Denormalised so a board card can show it without a request per card. */
  attachmentCount: number;
  /** Manager-owned final score from 0 to 100. Hidden from other employees. */
  score: number | null;
  scoreBy: string | null;
  scoredAt: string | null;

  appId: string | null;
  labels: string[];
  order: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  userId: string;
  body: string;
  createdAt: string;
}

/** A file handed in as proof the task was actually done. */
export interface TaskAttachment {
  id: string;
  taskId: string;
  userId: string;
  name: string;
  size: number;
  type: string;
  createdAt: string;
}

export interface PerformanceMetrics {
  total: number;
  completed: number;
  active: number;
  overdue: number;
  /** Handed in and sitting in a manager's queue. */
  awaitingReview: number;
  /** Sent back at least once. */
  returned: number;
  completionRate: number;
  onTimeRate: number;
  /** Approved without ever being sent back — the clarity-of-brief signal. */
  firstPassRate: number;
  averageScore: number | null;
  scoredTasks: number;
}

export interface PerformancePerson extends PerformanceMetrics {
  user: {
    id: string;
    name: string;
    avatarColor: string;
    department: string;
    subteam: string | null;
    jobRole: string | null;
  };
}

export interface PerformanceOverview {
  scope: 'self' | 'team';
  summary: PerformanceMetrics;
  people: PerformancePerson[];
  statuses: Array<{
    id: string;
    department: string;
    stage: string;
    labelAr: string;
    labelEn: string;
    count: number;
  }>;
}

/** Titles are written bilingually — the reader's language isn't known at write time. */
export type LocalisedText = { ar: string; en: string };

export interface Notification {
  id: string;
  userId: string;
  actorId?: string;
  type: string;
  title: LocalisedText | string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  actorId: string;
  action: string;
  subject: string;
  subjectId: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface SearchResult {
  type: 'app' | 'task' | 'user';
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  color?: string;
  department?: string;
  stage?: string;
  priority?: TaskPriority;
  route: string;
}

export type ActorMap = Record<string, { id: string; name: string; avatarColor: string }>;
