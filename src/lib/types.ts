export type Role = 'admin' | 'manager' | 'member' | 'viewer';
/** `pending` signed up through an invite link and is waiting to be approved. */
export type UserStatus = 'active' | 'pending' | 'disabled';
/** How wide a person's task view reaches. `null` = as wide as their role allows. */
export type VisibilityScope = 'own' | 'subteam' | 'department' | 'all';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type StageType = 'open' | 'active' | 'review' | 'signoff' | 'done';
/** Where a task sits in the assign → deliver → review → approve cycle. */
export type TaskState = 'assigned' | 'working' | 'submitted' | 'signed_off' | 'approved';
export type ReviewDecision = 'approved' | 'changes_requested';
export type AssignmentStatus =
  | 'unassigned'
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'clarification_requested'
  | 'due_date_proposed'
  | 'reassignment_requested';
export type EmbedMode = 'auto' | 'iframe' | 'newtab' | 'internal';

export interface User {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
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
  /** `null` = follow the role. Anything else narrows what they see. */
  visibilityScope: VisibilityScope | null;
  /** Durable special responsibilities such as Marketing's two approval gates. */
  taskWorkflowRoles?: string[];
  effectivePermissions: string[];
  /** What `visibilityScope` resolves to once capped by the permissions. */
  effectiveVisibility: VisibilityScope;
  /** Set when the account came in through an invite link. */
  inviteId?: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export type InviteState = 'active' | 'expired' | 'revoked' | 'exhausted';

/** An invite link, as the Users page sees it. The token is admin-only. */
export interface Invite {
  id: string;
  token: string;
  organizationId: string;
  label: string;
  role: Role;
  /** Empty = the person joining may pick any department. */
  departments: string[];
  emailDomain: string | null;
  permissions: string[] | null;
  appIds: string[] | null;
  visibilityScope: VisibilityScope | null;
  /** `0` = unlimited. */
  maxUses: number;
  useCount: number;
  expiresAt: string;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
  state: InviteState;
  joined: number;
  pending: number;
}

/** The trimmed view of an invite the public join page is allowed to load. */
export interface PublicInvite {
  label: string;
  emailDomain: string | null;
  requiresApproval: boolean;
  departments: Array<{
    id: string;
    ar: string;
    en: string;
    color: string;
    icon: string;
    subteams: Array<{
      id: string;
      ar: string;
      en: string;
      roles: Array<{ id: string; ar: string; en: string }>;
    }>;
  }>;
}

/** What the nav badge and the sign-in summary are built from. */
export interface TaskCounts {
  mine: number;
  overdue: number;
  dueToday: number;
  unanswered: number;
  awaitingMyReview: number;
  /** Unacknowledged Rework cycles that freeze the workspace until opened. */
  rework: number;
  reworkTasks: Array<{
    id: string;
    title: string;
    reworkCount: number;
    scorePenaltyPercent: number;
  }>;
}

export interface DirectoryUser {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  title: string | null;
  avatarColor: string;
  department: string;
  subteam: string | null;
  jobRole: string | null;
  role: Role;
}

export type MailConversationKind = 'channel' | 'direct' | 'mail';
export type MailChannelScope = 'public' | 'department' | 'private';

export interface MailPerson {
  id: string;
  name: string;
  email: string;
  title: string | null;
  department: string;
  subteam: string | null;
  avatarColor: string;
  role: Role;
}

export interface MailConversation {
  id: string;
  kind: MailConversationKind;
  scope: MailChannelScope;
  subject: string | null;
  nameAr: string | null;
  nameEn: string | null;
  descriptionAr: string;
  descriptionEn: string;
  department: string | null;
  memberIds: string[];
  announcementOnly: boolean;
  builtin: boolean;
  createdBy: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  lastSenderId: string | null;
  unreadCount: number;
  canManage: boolean;
  canPost: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MailAttachment {
  id: string;
  conversationId: string;
  messageId: string | null;
  userId: string;
  name: string;
  size: number;
  type: string;
  createdAt: string;
}

export interface MailMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  replyToId: string | null;
  mentionIds: string[];
  /** Set when the message announces a calendar entry arranged from this thread. */
  eventId: string | null;
  editedAt: string | null;
  attachments: MailAttachment[];
  /**
   * Who has opened the conversation since this message landed. Present on the
   * reader's own messages only — a receipt is the sender's to see.
   */
  readBy?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MailBootstrap {
  conversations: MailConversation[];
  people: MailPerson[];
  /** Who holds a live stream open right now; the stream keeps it current. */
  online: string[];
  unread: number;
  aiAvailable: boolean;
  aiModel: string | null;
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
  organizationId: string;
  title: string;
  reference: string;
  description: string;
  objective: string;
  definitionOfDone: string;
  /** Which department's board this task lives on. */
  department: string;
  /** Optional branch inside the department, e.g. Creative or Performance. */
  subteam: string | null;
  /** Stage id, only meaningful within that department. */
  stage: string;
  priority: TaskPriority;
  /** Everybody who owes the work. Equal partners — there is no lead. */
  assigneeIds: string[];
  /** Legacy single-owner field, still present on rows the migration predates. */
  assigneeId?: string | null;
  createdBy: string;
  /** Business date shown in the task table. */
  taskDate: string;
  dueDate: string | null;
  notes: string;
  effortPoints: 1 | 2 | 3 | 5 | 8 | 13 | null;
  estimatedMinutes: number | null;
  progress: number;
  /** One answer per partner: each accepts or declines their own assignment. */
  assignments: TaskAssignment[];
  assignedAt: string | null;
  assignedBy: string | null;

  /* ── the lifecycle ──────────────────────────────────────────────
     Written only by the workflow endpoints, never by the edit form. */

  /** Set when the task is taken off the board. The record outlives the card. */
  archivedAt: string | null;
  archivedBy: string | null;
  archiveReason: string;
  startedAt: string | null;
  /**
   * True when `startedAt` was written by the hand-in rather than by anybody
   * pressing "start" — the stamp exists, but nothing behind it is a measurement.
   */
  startedAtInferred?: boolean;
  /** Set when the assignee hands the work in; cleared if it is sent back. */
  submittedAt: string | null;
  /** The first hand-in ever made. Survives send-backs, so punctuality can too. */
  firstSubmittedAt?: string | null;
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
  /** Last rework cycle each assignee has opened. */
  reworkAcknowledgedBy: Record<string, number>;
  /** Denormalised so a board card can show it without a request per card. */
  attachmentCount: number;
  /** Manager-owned final score from 0 to 100. Hidden from other employees. */
  score: number | null;
  /** Reviewer's score before the automatic cumulative Rework deduction. */
  scoreBeforeReworkPenalty: number | null;
  scorePenaltyPercent: number;
  scoreBy: string | null;
  scoredAt: string | null;

  appId: string | null;
  labels: string[];
  order: number;
  /** Provenance for HR catalogue and automatically generated obligations. */
  source?: 'manual' | 'hr_catalogue' | 'hr_recurring' | string;
  sourceTemplateId?: string | null;
  recurrenceKey?: string | null;
  recurrenceFrequency?: string | null;
  generatedAt?: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskAssignment {
  userId: string;
  status: AssignmentStatus;
  note: string;
  acceptedAt: string | null;
  declinedAt: string | null;
  proposedDueDate: string | null;
}

export interface TaskAssignmentEvent {
  id: string;
  taskId: string;
  actorId: string;
  action: string;
  assigneeIds: string[];
  meta: Record<string, unknown>;
  createdAt: string;
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
  /** `link` deliverables carry a URL instead of bytes — a sheet, a folder, a live post. */
  kind: 'file' | 'link';
  url: string | null;
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
  /** Tasks currently waiting in the dedicated Rework column. */
  rework: number;
  /** Total return cycles across the selected tasks. */
  reworkCycles: number;
  completionRate: number;
  onTimeRate: number;
  /** Approved without ever being sent back — the clarity-of-brief signal. */
  firstPassRate: number;
  averageScore: number | null;
  scoredTasks: number;
  effortPoints: number;
  estimatedMinutes: number;
  /**
   * How long finishing takes, start to close, in days. Null when nothing has
   * been timed — an absent measurement rather than a zero.
   */
  averageDays: number | null;
  medianDays: number | null;
  fastestDays: number | null;
  slowestDays: number | null;
  /** How many completed tasks carried both stamps, so the reader can weigh it. */
  timedTasks: number;
}

export interface PerformancePerson extends PerformanceMetrics {
  daysWithoutTasks: number;
  idleDates: string[];
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
  period: { from: string | null; to: string | null; workingDays: number };
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
  body: LocalisedText | string;
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
