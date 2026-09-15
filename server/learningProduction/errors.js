/**
 * E-Learning Production — refusals.
 *
 * Every error this module sends has one shape:
 *
 *   { "error": { "code": "ASSET_BLOCKED", "message": "…", "details": {} } }
 *
 * The code is the contract — the browser turns it into a sentence in the
 * reader's own language. The message is plain English for logs and API
 * clients, never a stack trace or a table name.
 */

export class DomainError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const MESSAGES = {
  VALIDATION_FAILED: 'Some of the information is missing or not valid.',
  NOT_FOUND: 'We could not find that item.',
  FORBIDDEN: 'You do not have permission to do this.',
  INVALID_TRANSITION: 'This action is not available while the asset is in its current state.',
  ASSET_LOCKED: 'This asset is locked. Reopen it before making changes.',
  ASSET_BLOCKED: 'This stage is waiting for an earlier stage to be approved.',
  NOT_BLOCKED: 'This asset is not blocked, so there is nothing to override.',
  NOT_SUPPORTED: 'This action does not apply to this kind of asset.',
  CONTENT_REQUIRED: 'Add content or upload a version before submitting for review.',
  NEW_VERSION_REQUIRED: 'Make the requested changes and add a new version before resubmitting.',
  OWN_WORK: 'You cannot review or approve your own submission.',
  FEEDBACK_REQUIRED: 'Add a review summary or at least one comment so the maker knows what to change.',
  CHECKLIST_INCOMPLETE: 'Every required checklist item must pass before this video can be approved.',
  DRAFT_CONFLICT: 'This draft was changed in another window. Reload to see the latest version.',
  REASON_REQUIRED: 'Please give a reason. It is kept in the history.',
  ASSIGNEE_INVALID: 'That person is not an active member of this workspace.',
  REVIEWER_IS_ASSIGNEE: 'The reviewer must be someone other than the person doing the work.',
  COURSE_CODE_TAKEN: 'Another course already uses this code.',
  MODULE_NOT_EMPTY: 'Move or archive the lessons in this module first.',
  FILE_REQUIRED: 'Choose a file to upload.',
  FILE_TOO_LARGE: 'This file is larger than the upload limit.',
  FILE_TYPE_NOT_ALLOWED: 'This file type is not accepted for this stage.',
  LINK_INVALID: 'Enter a full link that starts with https://.',
  PREVIEW_EXISTS: 'This version already has a preview.',
  COMMENT_NOT_EDITABLE: 'Only the author can edit this comment.',
  SUGGESTION_OUTDATED: 'The suggested passage has changed since the suggestion was made.',
  LAST_MANAGER: 'A course needs at least one Production Manager.',
  STORAGE_UNAVAILABLE: 'E-Learning Production needs its database.',
  DEMO_DISABLED: 'Demo data is switched off on this deployment.',
  SERVER_ERROR: 'Something went wrong on our side. Nothing was changed. Please try again.',
};

/** The HTTP status a workflow refusal is answered with. */
const WORKFLOW_STATUS = {
  FORBIDDEN: 403,
  OWN_WORK: 403,
  NOT_SUPPORTED: 400,
};

export function messageFor(code) {
  return MESSAGES[code] ?? MESSAGES.SERVER_ERROR;
}

export function fail(status, code, details = {}, message = messageFor(code)) {
  return new DomainError(status, code, message, details);
}

export const badRequest = (code, details) => fail(400, code, details);
export const forbidden = (code = 'FORBIDDEN', details) => fail(403, code, details);
export const notFound = (details) => fail(404, 'NOT_FOUND', details);
export const conflict = (code, details) => fail(409, code, details);

export function validation(field, rule, extra = {}) {
  return fail(400, 'VALIDATION_FAILED', { field, rule, ...extra });
}

/** A refusal from `evaluateAsset`, carried to HTTP with the right status. */
export function workflowRefusal(code, details = {}) {
  return fail(WORKFLOW_STATUS[code] ?? 409, code, details);
}

/** The response for any thrown value. Unplanned errors never leak their message. */
export function toResponse(error) {
  if (error instanceof DomainError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message, details: error.details ?? {} } } };
  }
  if (error?.code === 'LEARNING_STORAGE_UNAVAILABLE') {
    return { status: 503, body: { error: { code: 'STORAGE_UNAVAILABLE', message: messageFor('STORAGE_UNAVAILABLE'), details: {} } } };
  }
  if (error?.type === 'entity.too.large') {
    return { status: 413, body: { error: { code: 'FILE_TOO_LARGE', message: messageFor('FILE_TOO_LARGE'), details: {} } } };
  }
  // Unique violation on the course code index — the one constraint a person can hit by typing.
  if (error?.code === '23505' && String(error?.constraint).includes('learning_courses_code_idx')) {
    return { status: 409, body: { error: { code: 'COURSE_CODE_TAKEN', message: messageFor('COURSE_CODE_TAKEN'), details: {} } } };
  }
  return null;
}
