/**
 * Production runs — the shapes the API returns.
 *
 * Enums come from `shared/learningProduction/runs.js` and
 * `workflowTemplates.js`, the same lists the server enforces and the database
 * checks. Labels arrive as `{ en, ar }` pairs (template text) or are looked up
 * in the string table by key (interface text); user-written text is shown as
 * it was written.
 */

import type {
  CANDIDATE_FILE_KINDS,
  CANDIDATE_SOURCES,
  CANDIDATE_STATUSES,
  CHECK_STATUSES,
  EVIDENCE_KINDS,
  IMPACT_DECISIONS,
  ISSUE_AREAS,
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  ORIGINS,
  RELEASE_KINDS,
  RELEASE_STATUSES,
  RUN_STATUSES,
  STAGE_STATUSES,
  TASK_ACTIONS,
  TASK_CLASSIFICATIONS,
  TASK_KINDS,
  TASK_STATUSES,
} from '@shared/learningProduction/runs';
import type { RUN_SCENARIOS } from '@shared/learningProduction/workflowTemplates';
import type { STAGE_KEYS } from '@shared/learningProduction/constants';
import type { ActivityEntry, AssetType, CourseCapabilities, DueState, People, Priority, Verdict } from './types';

export type Scenario = (typeof RUN_SCENARIOS)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type StageKey = (typeof STAGE_KEYS)[number];
export type StageStatus = (typeof STAGE_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskDisplay = TaskStatus | 'BLOCKED' | 'READY';
export type TaskKind = (typeof TASK_KINDS)[number];
export type TaskClassification = (typeof TASK_CLASSIFICATIONS)[number];
export type Origin = (typeof ORIGINS)[number];
export type CheckStatus = (typeof CHECK_STATUSES)[number];
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];
export type IssueArea = (typeof ISSUE_AREAS)[number];
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export type ReleaseKind = (typeof RELEASE_KINDS)[number];
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];
export type ImpactDecision = (typeof IMPACT_DECISIONS)[number];
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];
export type CandidateFileKind = (typeof CANDIDATE_FILE_KINDS)[number];
export type TaskAction = (typeof TASK_ACTIONS)[number];

/** Template text — stored in both languages, picked with `pick()`. */
export interface Pair {
  en: string;
  ar: string;
}

export interface Source {
  sheet?: string;
  rows?: number[];
  text?: string | null;
  path?: string;
  row?: number;
  cells?: string;
  activityId?: string;
  label?: string;
  note?: string;
  relation?: string;
  group?: { sheet: string; rows: number[]; text: string | null };
}

export interface Blocker {
  type: 'STAGE' | 'TASK' | 'ASSET';
  key: string;
  id?: string | null;
  label?: Pair | null;
  status?: string;
  assigneeUserId?: string | null;
  role?: string | null;
  ownerRole?: string | null;
}

export interface Gate {
  satisfied: boolean;
  done: number;
  total: number;
  openComments?: number;
}

export interface Run {
  id: string;
  courseId: string;
  runNumber: number;
  scenario: Scenario;
  templateVersionId: string | null;
  title: string | null;
  status: RunStatus;
  managerUserId: string | null;
  startDate: string | null;
  targetDate: string | null;
  sourceReleaseId: string | null;
  options: Record<string, boolean>;
  lessonAssetTypes: AssetType[];
  expertContractedUserId: string | null;
  expertSkipReason: string | null;
  isLegacy: boolean;
  createdAt: string;
  releasedAt: string | null;
  cancelReason: string | null;
  closedAt: string | null;
  closeReason: string | null;
}

export interface TaskSummary {
  id: string;
  key: string;
  stageKey: StageKey;
  label: Pair;
  kind: TaskKind;
  classification: TaskClassification;
  origin: Origin;
  approvalOrigin: Origin | null;
  role: string | null;
  reviewerRole: string | null;
  requiresApproval: boolean;
  requiresEvidence: boolean;
  sensitive: boolean;
  externalTool: string | null;
  status: TaskStatus;
  display: TaskDisplay;
  blockers: Blocker[];
  gate: Gate | null;
  priority: Priority;
  assigneeUserId: string | null;
  reviewerUserId: string | null;
  dueDate: string | null;
  dueState: DueState;
  waiveReason: string | null;
  after: string[];
  counts: {
    checklist: number;
    checklistDone: number;
    checklistPendingRequired: number;
    evidence: number;
    comments: number;
    submissions: number;
  } | null;
}

export interface StageView {
  id: string;
  key: StageKey;
  label: Pair;
  description: Pair | null;
  note: Pair | null;
  origin: Origin;
  source: Source | null;
  after: StageKey[];
  ownerRole: string | null;
  skippable: { when: string; label: Pair } | null;
  issueLog: boolean;
  lessonAssets: boolean;
  status: StageStatus;
  blockers: Blocker[];
  progress: { done: number; total: number; waived: number; optional: number };
  startedAt: string | null;
  completedAt: string | null;
  skippedAt: string | null;
  skippedBy: string | null;
  skipReason: string | null;
  issues: { open: number; total: number; blocking: number };
  tasks: TaskSummary[];
}

export interface ReadinessCheck {
  id: 'STAGES_COMPLETE' | 'CONTENT_APPROVED' | 'NO_BLOCKING_ISSUES' | 'DEPLOYMENT_VERIFIED' | 'UAT_SIGNED_OFF' | 'RELEASE_SIGNED_OFF';
  ok: boolean;
  open?: StageKey[];
  done?: number;
  total?: number;
  count?: number;
  status?: TaskStatus;
  taskKey?: string;
  gate?: boolean;
}

export interface RunProgress {
  content: { done: number; total: number; percent: number };
  workflow: { done: number; total: number; percent: number; waived: number; skippedStages: number };
  readiness: { assessed: boolean; checks: ReadinessCheck[]; readyForSignoff: boolean; readyToPublish: boolean };
  published: { id: string; versionLabel: string; publishedAt: string } | null;
}

export interface HealthState {
  health: 'ON_TRACK' | 'AT_RISK' | 'DELAYED' | 'COMPLETED';
  reasons: Array<{ code: string; [key: string]: unknown }>;
}

export interface Release {
  id: string;
  courseId: string;
  runId: string | null;
  runNumber: number | null;
  releaseNumber: number;
  versionLabel: string;
  kind: ReleaseKind;
  status: ReleaseStatus;
  summary: { lessons?: number; assets?: number; approvedAssets?: number; deliverables?: number };
  notes: string;
  preparedBy: string | null;
  preparedAt: string;
  signoffBy: string | null;
  signoffAt: string | null;
  signoffNotes: string | null;
  signoffOverrideReason: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  platformUrl: string | null;
  deploymentNotes: string | null;
  supersededAt: string | null;
  rolledBackAt: string | null;
  rolledBackBy: string | null;
  rollbackReason: string | null;
  withdrawnAt: string | null;
  withdrawReason: string | null;
  snapshot?: ReleaseSnapshot;
}

export interface ReleaseSnapshot {
  takenAt: string;
  lessons: Array<{
    id: string;
    name: string;
    moduleName: string | null;
    assets: Array<{ type: AssetType; assetId: string; status: string; applicable: boolean; approvedVersionId: string | null; versionNumber: number | null }>;
  }>;
  deliverables: Array<{ taskKey: string; label: Pair; submissionId: string; submissionNumber: number; evidenceIds: string[] }>;
}

export interface TemplateVersion {
  id: string;
  scenario: Exclude<Scenario, 'LEGACY'>;
  versionNumber: number;
  codeVersion: number;
  options: Record<string, boolean>;
  checksum: string;
  notes: string;
  isCurrent: boolean;
  createdBy: string | null;
  createdAt: string;
  retiredAt: string | null;
  runs?: number;
  openRuns?: number;
}

export interface RunView {
  run: Run;
  course: { id: string; name: string; code: string | null; currentReleaseId: string | null; hasCover: boolean };
  template: TemplateVersion | null;
  stages: StageView[];
  progress: RunProgress;
  health: HealthState;
  currentStage: StageKey | null;
  nextGate: {
    stageKey: StageKey;
    label: Pair;
    status: StageStatus;
    blockers: Blocker[];
    pending: Array<Pick<TaskSummary, 'id' | 'key' | 'label' | 'display' | 'kind' | 'assigneeUserId' | 'reviewerUserId' | 'role' | 'dueDate' | 'dueState' | 'gate'>>;
  } | null;
  pendingApprovals: TaskSummary[];
  overdueTasks: TaskSummary[];
  assetLoad: { overdue: number; open: number };
  releases: Release[];
  facts: { assets: Partial<Record<AssetType, { total: number; approved: number }>>; blockingIssues: number };
  runOpen: boolean;
  isCurrentRun: boolean;
  capabilities: CourseCapabilities & { runOpen: boolean };
  today: string;
  people: People;
}

export interface RunListEntry extends Run {
  templateVersionNumber: number | null;
  workflow: { done: number; total: number; percent: number };
  currentStage: { key: StageKey; label: Pair } | null;
}

export interface RunsResponse {
  runs: RunListEntry[];
  currentRunId: string | null;
  capabilities: CourseCapabilities;
  people: People;
}

export interface ChecklistLine {
  id: string;
  taskId: string;
  key: string;
  sortOrder: number;
  label: Pair;
  group: Pair | null;
  note: Pair | null;
  origin: Origin;
  source: Source | null;
  required: boolean;
  status: CheckStatus;
  comment: string;
  issueId: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface Evidence {
  id: string;
  taskId: string;
  kind: EvidenceKind;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  url: string | null;
  note: string;
  redacted: boolean;
  createdBy: string;
  createdAt: string;
  withdrawnAt: string | null;
  withdrawnBy: string | null;
  withdrawReason: string | null;
}

export interface Submission {
  id: string;
  submissionNumber: number;
  evidenceIds: string[];
  checklist: Array<{ key: string; status: CheckStatus; comment: string }>;
  notes: string;
  submittedBy: string;
  submittedAt: string;
  isResubmission: boolean;
  reviewerUserId: string | null;
  decision: 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED';
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string;
  adminOverride: boolean;
  overrideReason: string | null;
}

export interface TaskComment {
  id: string;
  parentId: string | null;
  userId: string;
  body: string;
  mentions: string[];
  createdAt: string;
}

export interface TaskDetail {
  task: TaskSummary & {
    description: Pair | null;
    note: Pair | null;
    condition: Pair | null;
    source: Source | null;
    evidenceLabel: Pair | null;
    startDate: string | null;
    submittedBy: string | null;
    submittedAt: string | null;
    approvedAt: string | null;
    approvedBy: string | null;
    doneAt: string | null;
    doneBy: string | null;
    waivedAt: string | null;
    waivedBy: string | null;
    dependencyOverrideAt: string | null;
    dependencyOverrideBy: string | null;
    dependencyOverrideReason: string | null;
  };
  stage: { id: string; key: StageKey; label: Pair; skipped: boolean; status: StageStatus };
  run: { id: string; runNumber: number; scenario: Scenario; status: RunStatus; lessonAssetTypes: AssetType[] };
  course: { id: string; name: string; code: string | null };
  blockers: Blocker[];
  checklist: ChecklistLine[];
  evidence: Evidence[];
  submissions: Submission[];
  comments: TaskComment[];
  activity: ActivityEntry[];
  evaluation: {
    actions: Record<TaskAction, Verdict>;
    blocked: boolean;
    isAssignee: boolean;
    isReviewer: boolean;
    approvalNeedsOverride: boolean;
    checklist: { total: number; addressed: number; required: number; pendingRequired: number; issues: number };
    evidenceCount: number;
    evidenceSinceDecision: number;
    canComment: boolean;
  };
  primary: { kind: 'action' | 'review' | 'waiting' | 'blocked' | 'done' | 'none' | 'automatic' | 'waived'; action: TaskAction | null; disabledReason: string | null };
  seeSensitive: boolean;
  upload: { maxBytes: number; accepted: string[] };
  people: People;
}

export interface Issue {
  id: string;
  runId: string;
  stageId: string;
  stageKey: StageKey | null;
  stageLabel: Pair | null;
  issueNumber: number;
  title: string;
  description: string;
  severity: IssueSeverity;
  area: IssueArea;
  status: IssueStatus;
  ownerUserId: string | null;
  dueDate: string | null;
  lessonId: string | null;
  lessonName: string | null;
  assetId: string | null;
  assetType: AssetType | null;
  taskId: string | null;
  checklistItemId: string | null;
  reportedBy: string;
  reportedAt: string;
  fixNote: string | null;
  fixedBy: string | null;
  fixedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verifyNote: string | null;
  wontFixReason: string | null;
  reopenCount: number;
}

export interface IssuesResponse {
  issues: Issue[];
  stages: Array<{ id: string; key: StageKey; label: Pair }>;
  canReport: boolean;
  people: People;
}

export type IssueActionKey = 'EDIT' | 'START' | 'FIX' | 'VERIFY' | 'REOPEN' | 'WONT_FIX';

export interface IssueDetail {
  issue: Issue;
  actions: Record<IssueActionKey, Verdict>;
  activity: Array<{ id: string; eventType: string; actorUserId: string | null; metadata: Record<string, unknown>; createdAt: string }>;
  people: People;
}

export interface ReleasesResponse {
  releases: Release[];
  currentReleaseId: string | null;
  people: People;
}

export interface ImpactResponse {
  sourceRelease: { id: string; versionLabel: string; kind: ReleaseKind; publishedAt: string | null } | null;
  snapshot: ReleaseSnapshot | null;
  items: Array<{ id: string; lessonId: string | null; assetType: AssetType | null; decision: ImpactDecision; note: string; decidedBy: string; decidedAt: string; appliedAt: string | null }>;
  taskId: string | null;
  taskStatus: TaskStatus | null;
  applied: boolean;
  canEdit: boolean;
  canApply: boolean;
  people: People;
}

export interface Candidate {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  source: CandidateSource;
  profileUrl: string | null;
  yearsExperience: number | null;
  status: CandidateStatus;
  assessment: Partial<Record<'relevantExperience' | 'teachingExperience' | 'english' | 'technical', number>>;
  notes: string;
  createdBy: string;
  updatedAt: string;
  files: Array<{ id: string; kind: CandidateFileKind; fileName: string; mimeType: string; fileSize: number; createdBy: string; createdAt: string }>;
}

export interface CandidatesResponse {
  candidates: Candidate[];
  canEdit: boolean;
  upload: { maxBytes: number; accepted: string[] };
  people: People;
}

export interface RunTeamResponse {
  members: Array<{ userId: string; roles: string[] }>;
  canManage: boolean;
  people: People;
}

/** One row of My Work or Reviews — a task, a lesson asset, an issue or a release. */
export interface WorkItem2 {
  kind: 'TASK' | 'ASSET' | 'ISSUE' | 'RELEASE';
  id: string;
  key?: string;
  title: Pair | string | null;
  assetType?: AssetType;
  course: { id: string; name: string; code: string | null };
  run?: { id: string; runNumber: number; scenario: Scenario; status?: RunStatus };
  stage?: { key: StageKey; label: Pair };
  lesson?: { id: string; name: string; moduleName: string | null } | null;
  status: string;
  display: string;
  severity?: IssueSeverity;
  priority: Priority;
  dueDate: string | null;
  dueState: DueState;
  blocked: boolean;
  blockers: Blocker[];
  assigneeUserId?: string | null;
  reviewerUserId?: string | null;
  submittedBy?: string | null;
  submittedAt?: string | null;
  isResubmission?: boolean;
  versionNumber?: number | null;
  openComments?: number;
  sensitive?: boolean;
  action: 'START' | 'CONTINUE' | 'FIX' | 'REVIEW' | 'VERIFY' | 'SIGN_OFF' | 'PUBLISH' | 'ASSIGN' | null;
  /** Ready work nobody holds, shown to the people who run the course. */
  unowned?: boolean;
  /** For a grouped line: how many lessons it covers. */
  count?: number;
  link: string;
}

export interface MyWork2Response {
  sections: { now: WorkItem2[]; review: WorkItem2[]; blocked: WorkItem2[]; done: WorkItem2[] };
  counts: { now: number; overdue: number; changes: number; review: number; blocked: number };
  people: People;
}

export type ReviewGroup = 'firstSubmissions' | 'resubmissions' | 'curriculum' | 'mediaQa' | 'signoff';

export interface Reviews2Response {
  groups: Record<ReviewGroup, WorkItem2[]>;
  all: WorkItem2[];
  scope: 'mine' | 'all';
  people: People;
}

export interface PortfolioRun extends Run {
  course: { id: string; name: string; code: string | null; hasCover: boolean };
  templateVersionNumber: number | null;
  currentStage: { key: StageKey; label: Pair; status: StageStatus; index: number } | null;
  stageCount: number;
  workflow: { done: number; total: number; percent: number };
  content: { done: number; total: number; percent: number };
  pendingApprovals: number;
  overdue: number;
  blockingIssues: number;
  openIssues: number;
  health: HealthState['health'];
  healthReasons: HealthState['reasons'];
}

export interface PortfolioResponse {
  runs: PortfolioRun[];
  kpis: { activeRuns: number; legacyRuns: number; pendingApprovals: number; overdue: number; blockingIssues: number; releasedLast90: number; atRisk: number };
  pipeline: Partial<Record<StageKey, number>>;
  bottleneck: StageKey | null;
  scenarioMix: Partial<Record<Scenario, number>>;
  releases: Array<{ id: string; versionLabel: string; publishedAt: string; status: ReleaseStatus; course: { id: string; name: string } }>;
  workload: Array<{ userId: string; active: number; reviewing: number; overdue: number }>;
  canCreate: boolean;
  people: People;
}

export interface TemplateSummary {
  scenario: Exclude<Scenario, 'LEGACY'>;
  label: Pair;
  options: Record<string, boolean>;
  lessonAssetTypes: AssetType[];
  roles: string[];
  counts: { stages: number; tasks: number; required: number; conditional: number; optional: number; approvals: number; automatic: number; proposed: number; hidden: number };
  stages: Array<{
    key: StageKey;
    label: Pair;
    description: Pair | null;
    origin: Origin;
    source: Source | null;
    after: StageKey[];
    ownerRole: string | null;
    skippable: { when: string; label: Pair } | null;
    issueLog: boolean;
    lessonAssets: boolean;
    note: Pair | null;
    tasks: Array<{
      key: string;
      label: Pair;
      kind: TaskKind;
      classification: TaskClassification;
      condition: Pair | null;
      role: string | null;
      reviewerRole: string | null;
      requiresApproval: boolean;
      approvalOrigin: Origin | null;
      requiresEvidence: boolean;
      evidenceLabel: Pair | null;
      sensitive: boolean;
      externalTool: string | null;
      origin: Origin;
      source: Source | null;
      note: Pair | null;
      checklistCount: number;
      after: string[];
    }>;
  }>;
}

export interface TemplatesResponse {
  templates: Array<{
    scenario: Exclude<Scenario, 'LEGACY'>;
    label: Pair;
    current: (TemplateVersion & { summary: TemplateSummary }) | null;
    versions: TemplateVersion[];
  }>;
  options: Array<{ key: string; scenarios: string[]; default: boolean; label: Pair }>;
  canAdmin: boolean;
  workbookChecksum: string;
  people: People;
}

export interface TraceabilityResponse {
  detail: Array<{ sheet: string; row: number; kind: string; hidden: boolean; text: string | null; status: string; usedBy: string[]; note: string | null }>;
  master: Array<{ path: string; row: number; cells: string; activityId: string | null; label: string | null; status: string; usedBy: string[] }>;
  anomalies: Array<{ id: string; where: string; finding: string; resolution: string }>;
  openDecisions: Array<{ id: string; affectsRelease: boolean; question: string; default: string }>;
  workbookChecksum: string;
}

export interface NotificationPreferences {
  preferences: { mutedEvents: string[]; dueSoonDays: number; overdueRepeatDays: number };
  events: string[];
}
