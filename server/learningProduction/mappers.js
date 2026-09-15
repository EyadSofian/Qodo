/**
 * Rows to API objects.
 *
 * The API speaks camelCase and plain numbers; PostgreSQL speaks snake_case and
 * returns `numeric` and `bigint` as strings. Converting in one place keeps a
 * coordinate from reaching the browser as "0.412000" in one endpoint and 0.412
 * in the next.
 */

export function num(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

export function mapCourse(r) {
  return {
    id: r.id,
    name: r.name,
    code: r.code ?? null,
    description: r.description ?? '',
    hasCover: Boolean(r.cover_storage_key),
    managerUserId: r.manager_user_id ?? null,
    status: r.status,
    priority: r.priority,
    startDate: r.start_date ?? null,
    targetDate: r.target_date ?? null,
    productionDefaults: r.production_defaults_json ?? {},
    isDemo: Boolean(r.is_demo),
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    archivedAt: iso(r.archived_at),
  };
}

export function mapModule(r) {
  return {
    id: r.id,
    courseId: r.course_id,
    name: r.name,
    description: r.description ?? '',
    sortOrder: r.sort_order,
  };
}

export function mapLesson(r) {
  return {
    id: r.id,
    courseId: r.course_id,
    moduleId: r.module_id ?? null,
    name: r.name,
    description: r.description ?? '',
    sortOrder: r.sort_order,
    estimatedDurationMinutes: r.estimated_duration_minutes ?? null,
    ownerUserId: r.owner_user_id ?? null,
    targetDate: r.target_date ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    archivedAt: iso(r.archived_at),
  };
}

export function mapAsset(r) {
  return {
    id: r.id,
    courseId: r.course_id,
    lessonId: r.lesson_id,
    assetType: r.asset_type,
    status: r.status,
    priority: r.priority,
    assigneeUserId: r.assignee_user_id ?? null,
    reviewerUserId: r.reviewer_user_id ?? null,
    startDate: r.start_date ?? null,
    dueDate: r.due_date ?? null,
    currentVersionId: r.current_version_id ?? null,
    assignedAt: iso(r.assigned_at),
    workStartedAt: iso(r.work_started_at),
    submittedAt: iso(r.submitted_at),
    submittedBy: r.submitted_by ?? null,
    reviewStartedAt: iso(r.review_started_at),
    changesRequestedAt: iso(r.changes_requested_at),
    changesRequestedVersionId: r.changes_requested_version_id ?? null,
    resubmittedAt: iso(r.resubmitted_at),
    approvedAt: iso(r.approved_at),
    approvedBy: r.approved_by ?? null,
    approvedVersionId: r.approved_version_id ?? null,
    lockedAt: iso(r.locked_at),
    lockedBy: r.locked_by ?? null,
    dependencyOverrideBy: r.dependency_override_by ?? null,
    dependencyOverrideAt: iso(r.dependency_override_at),
    dependencyOverrideReason: r.dependency_override_reason ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function mapVersion(r, { withContent = false } = {}) {
  return {
    id: r.id,
    assetId: r.asset_id,
    versionNumber: r.version_number,
    sourceKind: r.source_kind,
    fileName: r.file_name ?? null,
    mimeType: r.mime_type ?? null,
    fileSize: num(r.file_size),
    externalUrl: r.external_url ?? null,
    hasFile: Boolean(r.storage_key),
    hasPreview: Boolean(r.preview_storage_key),
    previewFileName: r.preview_file_name ?? null,
    durationSeconds: num(r.duration_seconds),
    versionNotes: r.version_notes ?? '',
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    ...(withContent ? { content: r.content_json ?? null } : {}),
  };
}

export function mapApproval(r) {
  return {
    id: r.id,
    assetId: r.asset_id,
    versionId: r.version_id,
    versionNumber: r.version_number ?? null,
    submittedBy: r.submitted_by,
    submittedAt: iso(r.submitted_at),
    isResubmission: Boolean(r.is_resubmission),
    reviewerUserId: r.reviewer_user_id ?? null,
    decision: r.decision,
    reviewStartedAt: iso(r.review_started_at),
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: iso(r.reviewed_at),
    notes: r.notes ?? '',
  };
}

/** A comment row, with whatever position it was left at joined in. */
export function mapComment(r) {
  const comment = {
    id: r.id,
    assetId: r.asset_id,
    versionId: r.version_id ?? null,
    versionNumber: r.version_number ?? null,
    parentCommentId: r.parent_comment_id ?? null,
    userId: r.user_id,
    commentType: r.comment_type,
    body: r.body,
    status: r.status,
    anchor: r.anchor_json ?? null,
    suggestionText: r.suggestion_text ?? null,
    suggestionAppliedAt: iso(r.suggestion_applied_at),
    createdAt: iso(r.created_at),
    editedAt: iso(r.edited_at),
    resolvedBy: r.resolved_by ?? null,
    resolvedAt: iso(r.resolved_at),
    annotation: null,
    audioMarker: null,
    videoMarker: null,
  };

  if (r.annotation_id) {
    comment.annotation = {
      id: r.annotation_id,
      pageNumber: r.page_number,
      annotationType: r.annotation_type,
      x: num(r.an_x),
      y: num(r.an_y),
      width: num(r.an_width),
      height: num(r.an_height),
      metadata: r.an_metadata ?? {},
      createdBy: r.an_created_by,
    };
  }
  if (r.audio_marker_id) {
    comment.audioMarker = { id: r.audio_marker_id, startSeconds: num(r.audio_start), endSeconds: num(r.audio_end) };
  }
  if (r.video_marker_id) {
    comment.videoMarker = {
      id: r.video_marker_id,
      startSeconds: num(r.video_start),
      endSeconds: num(r.video_end),
      frameTimestamp: num(r.frame_timestamp),
      drawing: r.video_annotation ?? null,
    };
  }
  return comment;
}
