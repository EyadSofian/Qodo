/**
 * E-Learning Production — the shapes the API returns.
 *
 * The enums are derived from `shared/learningProduction/constants.js`, the
 * same list the server enforces and the database checks, so a status cannot
 * exist in one place and not the others.
 */

import type {
  ANNOTATION_TYPES,
  ASSET_STATUSES,
  ASSET_TYPES,
  CHECKLIST_ITEM_STATUSES,
  COMMENT_TYPES,
  COURSE_HEALTH,
  COURSE_ROLES,
  COURSE_STATUSES,
  PRIORITIES,
  ACTIVITY_EVENTS,
} from '@shared/learningProduction/constants';
import type { ASSET_ACTIONS } from '@shared/learningProduction/workflow';

export type AssetType = (typeof ASSET_TYPES)[number];
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type CourseStatus = (typeof COURSE_STATUSES)[number];
export type CourseHealth = (typeof COURSE_HEALTH)[number];
export type CourseRole = (typeof COURSE_ROLES)[number];
export type CommentType = (typeof COMMENT_TYPES)[number];
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];
export type ChecklistStatus = (typeof CHECKLIST_ITEM_STATUSES)[number];
export type ActivityEvent = (typeof ACTIVITY_EVENTS)[number];
export type AssetAction = (typeof ASSET_ACTIONS)[number];
export type DueState = 'OVERDUE' | 'DUE_TODAY' | 'DUE_SOON' | null;
export type LessonState = 'COMPLETE' | 'CHANGES_REQUESTED' | 'IN_REVIEW' | 'IN_PRODUCTION' | 'NOT_STARTED';

export interface Person {
  id: string;
  name: string;
  avatarColor: string;
  title: string | null;
  active: boolean;
  department?: string | null;
}
export type People = Record<string, Person>;

export interface Me {
  permissions: string[];
  isAdmin: boolean;
  seesEveryCourse: boolean;
  canCreateCourse: boolean;
  canViewReports: boolean;
  managesWork: boolean;
  visibleCourses: number;
  demoAvailable: boolean;
}

export interface CourseSettings {
  wordsPerMinute: number;
  enforceDependencies: boolean;
  delayedOverdueShare: number;
  atRiskProgressGap: number;
  atRiskDaysBeforeTarget: number;
}

export type ProductionDefaults = Partial<Record<AssetType, { assigneeUserId: string | null; reviewerUserId: string | null }>>;

export interface Course {
  id: string;
  name: string;
  code: string | null;
  description: string;
  hasCover: boolean;
  managerUserId: string | null;
  status: CourseStatus;
  priority: Priority;
  startDate: string | null;
  targetDate: string | null;
  productionDefaults: ProductionDefaults;
  isDemo: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface HealthReason {
  code: 'TARGET_PASSED' | 'MANY_OVERDUE' | 'SOME_OVERDUE' | 'BEHIND_SCHEDULE' | 'TARGET_CLOSE';
  count?: number;
  share?: number;
  expected?: number;
  actual?: number;
  daysLeft?: number;
  targetDate?: string;
}

export interface CourseStats {
  lessons: number;
  completedLessons: number;
  totalAssets: number;
  completeAssets: number;
  openAssets: number;
  overdueAssets: number;
  reviewAssets: number;
  changesAssets: number;
}

export interface CourseWithStats extends Course {
  stats: CourseStats;
  progress: number;
  health: CourseHealth;
  healthReasons: HealthReason[];
  lastActivityAt: string | null;
}

export interface StageStat {
  assetType: AssetType;
  total: number;
  complete: number;
  review: number;
  changes: number;
  inProgress: number;
  overdue: number;
  percent: number;
}

export interface CourseCapabilities {
  edit: boolean;
  archive: boolean;
  createLessons: boolean;
  editLessons: boolean;
  manageTeam: boolean;
  viewReports: boolean;
  assign: Record<AssetType, boolean>;
  assignAny: boolean;
  roles: CourseRole[];
  isAdmin: boolean;
}

export interface ActivityEntry {
  id: string;
  eventType: ActivityEvent;
  metadata: Record<string, unknown>;
  createdAt: string;
  actorUserId: string | null;
  course: { id: string; name: string; code: string | null } | null;
  lesson: { id: string; name: string } | null;
  asset: { id: string; assetType: AssetType } | null;
  versionNumber: number | null;
}

export interface CourseDetail {
  course: CourseWithStats;
  settings: CourseSettings;
  stages: StageStat[];
  blocked: { assets: number; lessons: number };
  team: Array<{ userId: string; roles: CourseRole[] }>;
  activity: ActivityEntry[];
  capabilities: CourseCapabilities;
  people: People;
}

export interface ModuleRow {
  id: string;
  courseId: string;
  name: string;
  description: string;
  sortOrder: number;
}

export interface AssetSummary {
  id: string;
  assetType: AssetType;
  status: AssetStatus;
  priority: Priority;
  assigneeUserId: string | null;
  reviewerUserId: string | null;
  dueDate: string | null;
  dueState: DueState;
  blocked: boolean;
  waitingFor: AssetType[];
  currentVersionNumber: number | null;
  openComments: number;
  submittedAt: string | null;
  updatedAt: string | null;
}

export interface LessonProgress {
  complete: number;
  total: number;
  percent: number;
}

export interface MatrixLesson {
  id: string;
  name: string;
  moduleId: string | null;
  sortOrder: number;
  ownerUserId: string | null;
  targetDate: string | null;
  estimatedDurationMinutes: number | null;
  assets: Partial<Record<AssetType, AssetSummary>>;
  progress: LessonProgress;
  state: LessonState;
  currentStage: AssetType | null;
}

export interface MatrixResponse {
  course: { id: string; name: string; code: string | null };
  modules: ModuleRow[];
  lessons: MatrixLesson[];
  capabilities: CourseCapabilities;
  settings: { enforceDependencies: boolean };
  today: string;
  people: People;
}

export interface Lesson {
  id: string;
  courseId: string;
  moduleId: string | null;
  moduleName?: string | null;
  name: string;
  description: string;
  sortOrder: number;
  estimatedDurationMinutes: number | null;
  ownerUserId: string | null;
  targetDate: string | null;
  archivedAt: string | null;
}

export interface LessonDetail {
  lesson: Lesson;
  course: { id: string; name: string; code: string | null };
  assets: AssetSummary[];
  progress: LessonProgress;
  state: LessonState;
  currentStage: AssetType | null;
  capabilities: CourseCapabilities;
  people: People;
}

/**
 * The slice of an asset's current version its card draws on the Assets board.
 * A recognisable fragment, never the content itself — see `previewOf` in
 * `server/learningProduction/services/lessonService.js`.
 */
export type AssetPreview =
  | { kind: 'OUTLINE'; sections: Array<{ key: string; text: string }>; sectionCount: number }
  | { kind: 'SCRIPT'; mode: 'SLIDE' | 'SCENE'; blockCount: number; words: number; blocks: Array<{ title: string; narration: string }> }
  | { kind: 'PPT'; fileName: string | null; fileSize: number | null; hasPreview: boolean; externalUrl: string | null }
  | { kind: 'VOICE_OVER'; durationSeconds: number | null; fileName: string | null; hasTranscript: boolean; transcript: string | null }
  | { kind: 'VIDEO'; durationSeconds: number | null; fileName: string | null; externalUrl: string | null };

export interface BoardAsset extends AssetSummary {
  versionCount: number;
  versionNotes: string;
  versionCreatedAt: string | null;
  versionCreatedBy: string | null;
  preview: AssetPreview | null;
}

export interface AssetBoardResponse {
  lesson: Lesson & { moduleName: string | null };
  course: { id: string; name: string; code: string | null };
  assets: BoardAsset[];
  progress: LessonProgress;
  state: LessonState;
  currentStage: AssetType | null;
  capabilities: CourseCapabilities;
  people: People;
}

export interface Verdict {
  allowed: boolean;
  reason: string | null;
}

export interface Version {
  id: string;
  assetId: string;
  versionNumber: number;
  sourceKind: 'FILE' | 'LINK' | 'CONTENT';
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  externalUrl: string | null;
  hasFile: boolean;
  hasPreview: boolean;
  previewFileName: string | null;
  durationSeconds: number | null;
  versionNotes: string;
  createdBy: string;
  createdAt: string;
  decision?: 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | null;
  content?: unknown;
}

export interface Approval {
  id: string;
  versionId: string;
  versionNumber: number | null;
  submittedBy: string;
  submittedAt: string;
  isResubmission: boolean;
  reviewerUserId: string | null;
  decision: 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED';
  reviewedBy: string | null;
  reviewedAt: string | null;
  notes: string;
}

export interface Asset {
  id: string;
  courseId: string;
  lessonId: string;
  assetType: AssetType;
  status: AssetStatus;
  priority: Priority;
  assigneeUserId: string | null;
  reviewerUserId: string | null;
  startDate: string | null;
  dueDate: string | null;
  currentVersionId: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  approvedVersionId: string | null;
  lockedAt: string | null;
  dependencyOverrideBy: string | null;
  dependencyOverrideAt: string | null;
  dependencyOverrideReason: string | null;
  updatedAt: string;
}

export interface OutlineContent {
  sections: Record<string, string>;
}

export interface ScriptBlock {
  id: string;
  title: string;
  narration: string;
  visual: string;
  pronunciation: string;
  pauses: string;
  emphasis: string;
  notes: string;
  manualDurationSeconds: number | null;
}

export interface ScriptContent {
  mode: 'SLIDE' | 'SCENE';
  blocks: ScriptBlock[];
}

export interface AssetDetail {
  asset: Asset;
  lesson: { id: string; name: string; moduleId: string | null; moduleName: string | null };
  course: { id: string; name: string; code: string | null };
  settings: { wordsPerMinute: number; enforceDependencies: boolean };
  siblings: Array<{ assetType: AssetType; id: string | null; status: AssetStatus }>;
  evaluation: {
    actions: Record<AssetAction, Verdict>;
    blocked: boolean;
    waitingFor: Array<{ assetType: AssetType; assetId: string | null; status: AssetStatus }>;
    overridden: boolean;
    isAssignee: boolean;
    isReviewer: boolean;
    canResolveComments: boolean;
    canComment: boolean;
    hasContent: boolean;
    versionSinceChanges: boolean;
    draftDiffers: boolean;
  };
  primary: { kind: 'action' | 'review' | 'waiting' | 'blocked' | 'done' | 'none'; action: AssetAction | null; disabledReason: string | null };
  currentVersion: Version | null;
  draft: { content: unknown; revision: number; updatedAt: string | null; updatedBy: string | null } | null;
  versions: Version[];
  approvals: Approval[];
  openComments: number;
  references: Array<{ assetType: AssetType; assetId: string; status: AssetStatus; approved: boolean; version: Version }>;
  upload: { maxBytes: number; accepted: string[]; allowsLink: boolean; previewMaxBytes: number } | null;
  people: People;
}

export interface Geometry {
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: Array<[number, number]>;
}

export interface Shape {
  annotationType: AnnotationType;
  geometry: Geometry;
  color: string;
}

export interface ReviewComment {
  id: string;
  assetId: string;
  versionId: string | null;
  versionNumber: number | null;
  parentCommentId: string | null;
  userId: string;
  commentType: CommentType;
  body: string;
  status: 'OPEN' | 'RESOLVED';
  anchor: Record<string, unknown> | null;
  suggestionText: string | null;
  suggestionAppliedAt: string | null;
  createdAt: string;
  editedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  annotation: (Geometry & { id: string; pageNumber: number; annotationType: AnnotationType; metadata: { color?: string; points?: Array<[number, number]> | null }; createdBy: string }) | null;
  audioMarker: { id: string; startSeconds: number; endSeconds: number | null } | null;
  videoMarker: { id: string; startSeconds: number; endSeconds: number | null; frameTimestamp: number | null; drawing: Shape[] | null } | null;
  replies: ReviewComment[];
}

export interface CommentsResponse {
  comments: ReviewComment[];
  canComment: boolean;
  canResolve: boolean;
  people: People;
}

export interface NewComment {
  body: string;
  commentType?: CommentType;
  versionId?: string | null;
  parentCommentId?: string;
  anchor?: Record<string, unknown>;
  suggestionText?: string;
  annotation?: { pageNumber: number; annotationType: AnnotationType; geometry: Geometry; color?: string };
  marker?: { startSeconds: number; endSeconds?: number | null; frameTimestamp?: number | null; drawing?: Shape[] };
}

export interface WorkItem extends AssetSummary {
  submittedBy: string | null;
  approvedAt: string | null;
  isResubmission?: boolean;
  course: { id: string; name: string; code: string | null };
  lesson: { id: string; name: string; moduleName: string | null };
}

export interface MyWorkResponse {
  sections: {
    overdue: WorkItem[];
    changesRequested: WorkItem[];
    assigned: WorkItem[];
    waitingForMyReview: WorkItem[];
    recentlyCompleted: WorkItem[];
  };
  people: People;
}

export interface ReviewedItem {
  approvalId: string;
  decision: 'APPROVED' | 'CHANGES_REQUESTED';
  reviewedAt: string;
  notes: string;
  versionNumber: number;
  id: string;
  assetType: AssetType;
  status: AssetStatus;
  priority: Priority;
  assigneeUserId: string | null;
  course: { id: string; name: string; code: string | null };
  lesson: { id: string; name: string; moduleName: string | null };
}

export interface ReviewsResponse {
  sections: { needsReview: WorkItem[]; resubmitted: WorkItem[]; recentlyReviewed: ReviewedItem[] };
  people: People;
}

export interface WorkloadRow {
  userId: string;
  active: number;
  reviewing: number;
  overdue: number;
}

export interface DashboardResponse {
  kpis: {
    activeCourses: number;
    totalLessons: number;
    completedLessons: number;
    underReview: number;
    changesRequested: number;
    overdue: number;
    dueSoon: number;
  };
  overallPercent: number;
  stages: StageStat[];
  attention: { overdue: number; review: number; changes: number; blockedAssets: number; blockedLessons: number };
  /** Every visible asset by status, and courses by health — the dashboard's two rings. */
  statusMix: Record<AssetStatus, number>;
  healthCounts: Partial<Record<CourseHealth, number>>;
  /** Approvals per week for the last eight weeks, oldest first. */
  throughput: Array<{ week: string; approved: number }>;
  watchlist: CourseWithStats[];
  workload: WorkloadRow[];
  activity: ActivityEntry[];
  mine: { assigned: number; reviews: number; changes: number; overdue: number };
  managerView: boolean;
  canCreateCourse: boolean;
  people: People;
}

export type AttentionKind = 'overdue' | 'review' | 'changes' | 'blocked';

export interface StageReport extends StageStat {
  decisions: number;
  avgReviewHours: number | null;
  waiting: number;
  avgWaitingHours: number | null;
  oldestWaitingHours: number | null;
  waitDays: number | null;
  avgVersions: number | null;
  avgChangeRounds: number | null;
  avgProductionDays: number | null;
}

export interface ReportsResponse {
  courses: CourseWithStats[];
  stages: StageReport[];
  bottleneck: { assetType: AssetType; waitDays: number } | null;
  throughput: Array<{ week: string; approved: number }>;
  workload: WorkloadRow[];
  overdue: WorkItem[];
  reviewTurnaroundHours: number | null;
  people: People;
}

export interface TeamResponse {
  members: Array<{ userId: string; roles: CourseRole[]; workload: { active: number; reviewing: number; overdue: number } }>;
  contributors: Array<{ userId: string; workload: { active: number; reviewing: number; overdue: number } }>;
  productionDefaults: ProductionDefaults;
  capabilities: CourseCapabilities;
  people: People;
}

export interface ChecklistItem {
  id: string;
  sortOrder: number;
  category: string | null;
  label: string;
  required: boolean;
  status: ChecklistStatus;
  notes: string;
}

export interface Transcript {
  id: string;
  versionId: string;
  source: 'MANUAL' | 'IMPORTED' | 'EXTERNAL';
  body: string;
  segments: Array<{ startSeconds: number; endSeconds: number | null; text: string }>;
}

export interface FileEntry extends Version {
  assetType: AssetType;
  isCurrent: boolean;
  isApproved: boolean;
  lesson: { id: string; name: string };
}
