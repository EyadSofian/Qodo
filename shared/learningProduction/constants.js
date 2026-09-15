/**
 * E-Learning Production — the vocabulary.
 *
 * One definition, read by the Express API (which enforces it) and by React
 * (which only renders it). The database repeats the enums as CHECK constraints
 * in `server/learningProduction/migrations/001_foundation.sql`; the
 * `learningProduction.workflow.test.js` suite reads that file and fails if the
 * two lists drift apart.
 *
 * This module owns its own domain. Nothing here refers to Qodo Projects or to
 * the workspace task board: a course is not a project and a PPT is not a task.
 */

/** The five production assets, in the order the work happens. */
export const ASSET_TYPES = /** @type {const} */ (['OUTLINE', 'PPT', 'SCRIPT', 'VOICE_OVER', 'VIDEO']);

/** URL segment for each asset — `/lessons/:lessonId/voice-over` reads better than an enum. */
export const ASSET_SLUGS = /** @type {const} */ ({
  OUTLINE: 'outline',
  PPT: 'ppt',
  SCRIPT: 'script',
  VOICE_OVER: 'voice-over',
  VIDEO: 'video',
});

/**
 * Stage names for text the server writes — notifications are stored in both
 * languages because the reader's choice is not known when they are sent. The
 * interface itself reads its own string table.
 */
export const ASSET_TYPE_LABELS = /** @type {const} */ ({
  OUTLINE: { ar: 'المخطط', en: 'Outline' },
  PPT: { ar: 'العرض التقديمي', en: 'PPT' },
  SCRIPT: { ar: 'السكريبت', en: 'Script' },
  VOICE_OVER: { ar: 'التعليق الصوتي', en: 'Voice Over' },
  VIDEO: { ar: 'الفيديو', en: 'Video' },
});

export function assetTypeFromSlug(slug) {
  const found = Object.entries(ASSET_SLUGS).find(([, value]) => value === String(slug ?? '').toLowerCase());
  return found ? found[0] : null;
}

/** Text assets are written inside the workspace; file assets are uploaded. */
export const TEXT_ASSET_TYPES = /** @type {const} */ (['OUTLINE', 'SCRIPT']);
export const FILE_ASSET_TYPES = /** @type {const} */ (['PPT', 'VOICE_OVER', 'VIDEO']);

export function isTextAsset(type) {
  return TEXT_ASSET_TYPES.includes(type);
}

export const ASSET_STATUSES = /** @type {const} */ ([
  'NOT_STARTED',
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'CHANGES_REQUESTED',
  'RESUBMITTED',
  'APPROVED',
  'LOCKED',
]);

/** Approved and locked both count as finished work. */
export const COMPLETE_STATUSES = /** @type {const} */ (['APPROVED', 'LOCKED']);
/** Waiting on a reviewer's decision. */
export const REVIEW_STATUSES = /** @type {const} */ (['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED']);
/** The work is with its maker. */
export const WORKING_STATUSES = /** @type {const} */ (['ASSIGNED', 'IN_PROGRESS', 'CHANGES_REQUESTED']);

export function isComplete(status) {
  return COMPLETE_STATUSES.includes(status);
}

export function isInReview(status) {
  return REVIEW_STATUSES.includes(status);
}

export const PRIORITIES = /** @type {const} */ (['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export const DEFAULT_PRIORITY = 'NORMAL';

export const COURSE_STATUSES = /** @type {const} */ (['ACTIVE', 'ON_HOLD']);
export const COURSE_HEALTH = /** @type {const} */ (['ON_TRACK', 'AT_RISK', 'DELAYED', 'COMPLETED']);

/**
 * Course roles. One person may hold several; what each role may do lives in
 * `ROLE_GRANTS` in `permissions.js`.
 */
export const COURSE_ROLES = /** @type {const} */ ([
  'PRODUCTION_MANAGER',
  'COURSE_MANAGER',
  'SUBJECT_MATTER_EXPERT',
  'INSTRUCTIONAL_DESIGNER',
  'OUTLINE_WRITER',
  'SCRIPT_WRITER',
  'PPT_DESIGNER',
  'VOICE_OVER_ARTIST',
  'AUDIO_REVIEWER',
  'VIDEO_EDITOR',
  'QUALITY_REVIEWER',
  'VIEWER',
]);

export const COMMENT_TYPES = /** @type {const} */ ([
  'GENERAL',
  'TEXT_SELECTION',
  'SCRIPT_BLOCK',
  'SUGGESTION',
  'SLIDE',
  'ANNOTATION',
  'AUDIO_TIMESTAMP',
  'VIDEO_TIMESTAMP',
]);

export const COMMENT_STATUSES = /** @type {const} */ (['OPEN', 'RESOLVED']);

export const ANNOTATION_TYPES = /** @type {const} */ ([
  'PIN',
  'RECTANGLE',
  'CIRCLE',
  'ARROW',
  'FREEHAND',
  'HIGHLIGHT',
]);

export const APPROVAL_DECISIONS = /** @type {const} */ (['PENDING', 'APPROVED', 'CHANGES_REQUESTED']);

export const CHECKLIST_ITEM_STATUSES = /** @type {const} */ (['PENDING', 'PASSED', 'ISSUE']);

export const VERSION_SOURCES = /** @type {const} */ (['FILE', 'LINK', 'CONTENT']);

export const TRANSCRIPT_SOURCES = /** @type {const} */ (['MANUAL', 'IMPORTED', 'EXTERNAL']);

/**
 * What the activity log records. Domain events only — a filter being changed
 * or a panel being opened is not history anybody will ever ask about.
 */
export const ACTIVITY_EVENTS = /** @type {const} */ ([
  'COURSE_CREATED',
  'COURSE_UPDATED',
  'COURSE_ARCHIVED',
  'COURSE_RESTORED',
  'MODULE_CREATED',
  'MODULE_UPDATED',
  'MODULE_ARCHIVED',
  'LESSON_CREATED',
  'LESSON_UPDATED',
  'LESSON_ARCHIVED',
  'LESSON_RESTORED',
  'TEAM_MEMBER_ADDED',
  'TEAM_MEMBER_UPDATED',
  'TEAM_MEMBER_REMOVED',
  'ASSET_ASSIGNED',
  'WORK_STARTED',
  'VERSION_UPLOADED',
  'SUBMITTED_FOR_REVIEW',
  'REVIEW_STARTED',
  'CHANGES_REQUESTED',
  'RESUBMITTED',
  'APPROVED',
  'LOCKED',
  'REOPENED',
  'DEPENDENCY_OVERRIDDEN',
  'COMMENT_CREATED',
  'COMMENT_RESOLVED',
  'COMMENT_REOPENED',
  'SUGGESTION_APPLIED',
  'CHECKLIST_UPDATED',
  'TRANSCRIPT_UPDATED',
]);

/**
 * Which approved assets each stage waits for.
 *
 * PPT and Script both start from an approved Outline and may run side by side;
 * Voice Over reads the approved Script; the Video needs all three. A course can
 * switch enforcement off, and a manager can override one asset — see
 * `evaluateAsset` in `workflow.js`.
 */
export const STAGE_DEPENDENCIES = /** @type {const} */ ({
  OUTLINE: [],
  PPT: ['OUTLINE'],
  SCRIPT: ['OUTLINE'],
  VOICE_OVER: ['SCRIPT'],
  VIDEO: ['PPT', 'SCRIPT', 'VOICE_OVER'],
});

/** The structured sections of a lesson outline, in reading order. */
export const OUTLINE_SECTIONS = /** @type {const} */ ([
  'lessonTitle',
  'learningObjectives',
  'keyTopics',
  'definitions',
  'examples',
  'exercises',
  'caseStudies',
  'references',
  'estimatedDuration',
  'instructorNotes',
  'productionNotes',
]);

/** The QA checklist a new course starts with for its videos. */
export const DEFAULT_VIDEO_CHECKLIST = /** @type {const} */ ([
  'CONTENT_ACCURACY',
  'VISUAL_QUALITY',
  'AUDIO_QUALITY',
  'SYNCHRONIZATION',
  'BRANDING',
  'SPELLING',
  'ANIMATIONS',
  'TRANSITIONS',
  'TECHNICAL_QUALITY',
  'FINAL_APPROVAL',
]);

/**
 * Course-level settings and their defaults.
 *
 * Narration speed is here rather than hardcoded: an English course read at a
 * measured pace and an Arabic one read by a fast presenter differ by forty
 * words a minute, and a duration estimate that ignores that is wrong for half
 * the catalogue.
 */
export const DEFAULT_COURSE_SETTINGS = Object.freeze({
  wordsPerMinute: 130,
  enforceDependencies: true,
  /** A course whose open work is at least this share overdue is Delayed. */
  delayedOverdueShare: 0.1,
  /** Actual progress this many points behind the straight line to the target is At Risk. */
  atRiskProgressGap: 15,
  /** Inside this many days of the target, anything under 90% is At Risk. */
  atRiskDaysBeforeTarget: 7,
});

export const SETTINGS_LIMITS = Object.freeze({
  wordsPerMinute: [60, 300],
  delayedOverdueShare: [0.01, 1],
  atRiskProgressGap: [1, 100],
  atRiskDaysBeforeTarget: [0, 90],
});

/** A due date inside this many days is "due soon". */
export const DUE_SOON_DAYS = 2;
