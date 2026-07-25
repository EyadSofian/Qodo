export type Role = 'admin' | 'manager' | 'member' | 'viewer';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type StageType = 'open' | 'active' | 'review' | 'done';
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
  /** Stage id, only meaningful within that department. */
  stage: string;
  priority: TaskPriority;
  assigneeId: string | null;
  createdBy: string;
  dueDate: string | null;
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
