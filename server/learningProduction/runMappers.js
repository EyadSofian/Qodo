/**
 * Production-run rows to API objects. See mappers.js for why this happens in
 * one place.
 */

import { num } from './mappers.js';

const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

export function mapRun(r) {
  return {
    id: r.id,
    courseId: r.course_id,
    runNumber: r.run_number,
    scenario: r.scenario,
    templateVersionId: r.template_version_id ?? null,
    title: r.title ?? null,
    status: r.status,
    managerUserId: r.manager_user_id ?? null,
    startDate: r.start_date ?? null,
    targetDate: r.target_date ?? null,
    sourceReleaseId: r.source_release_id ?? null,
    options: r.options_json ?? {},
    lessonAssetTypes: r.lesson_asset_types ?? [],
    expertContractedUserId: r.expert_contracted_user_id ?? null,
    expertSkipReason: r.expert_skip_reason ?? null,
    isLegacy: Boolean(r.is_legacy),
    isDemo: Boolean(r.is_demo),
    createdBy: r.created_by ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    releasedAt: iso(r.released_at),
    cancelledAt: iso(r.cancelled_at),
    cancelReason: r.cancel_reason ?? null,
    closedAt: iso(r.closed_at),
    closeReason: r.close_reason ?? null,
  };
}

export function mapStage(r) {
  return {
    id: r.id,
    runId: r.run_id,
    key: r.stage_key,
    sortOrder: r.sort_order,
    label: r.label_json,
    description: r.description_json ?? null,
    note: r.note_json ?? null,
    origin: r.origin,
    source: r.source_json ?? null,
    after: r.after_keys ?? [],
    ownerRole: r.owner_role ?? null,
    skippable: r.skippable_json ?? null,
    issueLog: Boolean(r.issue_log),
    lessonAssets: Boolean(r.lesson_assets),
    status: r.status,
    startedAt: iso(r.started_at),
    completedAt: iso(r.completed_at),
    skippedAt: iso(r.skipped_at),
    skippedBy: r.skipped_by ?? null,
    skipReason: r.skip_reason ?? null,
  };
}

export function mapTask(r) {
  return {
    id: r.id,
    runId: r.run_id,
    stageId: r.stage_id,
    stageKey: r.stage_key ?? null,
    key: r.task_key,
    sortOrder: r.sort_order,
    label: r.label_json,
    description: r.description_json ?? null,
    note: r.note_json ?? null,
    condition: r.condition_json ?? null,
    origin: r.origin,
    approvalOrigin: r.approval_origin ?? null,
    source: r.source_json ?? null,
    kind: r.kind,
    classification: r.classification,
    role: r.role ?? null,
    reviewerRole: r.reviewer_role ?? null,
    requiresEvidence: Boolean(r.requires_evidence),
    evidenceLabel: r.evidence_label_json ?? null,
    requiresApproval: Boolean(r.requires_approval),
    sensitive: Boolean(r.sensitive),
    externalTool: r.external_tool ?? null,
    rule: r.rule_json ?? null,
    status: r.status,
    priority: r.priority,
    assigneeUserId: r.assignee_user_id ?? null,
    reviewerUserId: r.reviewer_user_id ?? null,
    startDate: r.start_date ?? null,
    dueDate: r.due_date ?? null,
    assignedAt: iso(r.assigned_at),
    startedAt: iso(r.started_at),
    submittedAt: iso(r.submitted_at),
    submittedBy: r.submitted_by ?? null,
    reviewStartedAt: iso(r.review_started_at),
    changesRequestedAt: iso(r.changes_requested_at),
    approvedAt: iso(r.approved_at),
    approvedBy: r.approved_by ?? null,
    doneAt: iso(r.done_at),
    doneBy: r.done_by ?? null,
    waivedAt: iso(r.waived_at),
    waivedBy: r.waived_by ?? null,
    waiveReason: r.waive_reason ?? null,
    reopenedAt: iso(r.reopened_at),
    dependencyOverrideBy: r.dependency_override_by ?? null,
    dependencyOverrideAt: iso(r.dependency_override_at),
    dependencyOverrideReason: r.dependency_override_reason ?? null,
    after: r.after_keys ?? [],
    updatedAt: iso(r.updated_at),
  };
}

export function mapChecklistItem(r) {
  return {
    id: r.id,
    taskId: r.task_id,
    key: r.item_key,
    sortOrder: r.sort_order,
    label: r.label_json,
    group: r.group_json ?? null,
    note: r.note_json ?? null,
    origin: r.origin,
    source: r.source_json ?? null,
    required: Boolean(r.required),
    status: r.status,
    comment: r.note ?? '',
    issueId: r.issue_id ?? null,
    updatedBy: r.updated_by ?? null,
    updatedAt: iso(r.updated_at),
  };
}

export function mapEvidence(r, { redact = false } = {}) {
  return {
    id: r.id,
    taskId: r.task_id,
    kind: r.kind,
    fileName: redact ? null : r.file_name ?? null,
    mimeType: r.mime_type ?? null,
    fileSize: num(r.file_size),
    url: redact ? null : r.url ?? null,
    note: redact ? '' : r.note ?? '',
    redacted: redact,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    withdrawnAt: iso(r.withdrawn_at),
    withdrawnBy: r.withdrawn_by ?? null,
    withdrawReason: r.withdraw_reason ?? null,
  };
}

export function mapSubmission(r) {
  return {
    id: r.id,
    taskId: r.task_id,
    submissionNumber: r.submission_number,
    evidenceIds: r.evidence_ids ?? [],
    checklist: r.checklist_json ?? [],
    notes: r.notes ?? '',
    submittedBy: r.submitted_by,
    submittedAt: iso(r.submitted_at),
    isResubmission: Boolean(r.is_resubmission),
    reviewerUserId: r.reviewer_user_id ?? null,
    decision: r.decision,
    reviewStartedAt: iso(r.review_started_at),
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: iso(r.reviewed_at),
    reviewNotes: r.review_notes ?? '',
    adminOverride: Boolean(r.admin_override),
    overrideReason: r.override_reason ?? null,
  };
}

export function mapTaskComment(r) {
  return {
    id: r.id,
    taskId: r.task_id,
    parentId: r.parent_id ?? null,
    userId: r.user_id,
    body: r.body,
    mentions: r.mentions ?? [],
    createdAt: iso(r.created_at),
    editedAt: iso(r.edited_at),
  };
}

export function mapIssue(r) {
  return {
    id: r.id,
    runId: r.run_id,
    stageId: r.stage_id,
    stageKey: r.stage_key ?? null,
    stageLabel: r.stage_label ?? null,
    issueNumber: r.issue_number,
    title: r.title,
    description: r.description ?? '',
    severity: r.severity,
    area: r.area,
    status: r.status,
    ownerUserId: r.owner_user_id ?? null,
    dueDate: r.due_date ?? null,
    lessonId: r.lesson_id ?? null,
    lessonName: r.lesson_name ?? null,
    assetId: r.asset_id ?? null,
    assetType: r.asset_type ?? null,
    taskId: r.task_id ?? null,
    checklistItemId: r.checklist_item_id ?? null,
    reportedBy: r.reported_by,
    reportedAt: iso(r.reported_at),
    fixNote: r.fix_note ?? null,
    fixedBy: r.fixed_by ?? null,
    fixedAt: iso(r.fixed_at),
    verifiedBy: r.verified_by ?? null,
    verifiedAt: iso(r.verified_at),
    verifyNote: r.verify_note ?? null,
    wontFixReason: r.wont_fix_reason ?? null,
    wontFixBy: r.wont_fix_by ?? null,
    reopenCount: r.reopen_count ?? 0,
    updatedAt: iso(r.updated_at),
  };
}

export function mapRelease(r, { withSnapshot = false } = {}) {
  return {
    id: r.id,
    courseId: r.course_id,
    runId: r.run_id ?? null,
    runNumber: r.run_number ?? null,
    releaseNumber: r.release_number,
    versionLabel: r.version_label,
    kind: r.kind,
    status: r.status,
    summary: r.summary_json ?? {},
    notes: r.notes ?? '',
    preparedBy: r.prepared_by ?? null,
    preparedAt: iso(r.prepared_at),
    signoffBy: r.signoff_by ?? null,
    signoffAt: iso(r.signoff_at),
    signoffNotes: r.signoff_notes ?? null,
    signoffOverrideReason: r.signoff_override_reason ?? null,
    publishedBy: r.published_by ?? null,
    publishedAt: iso(r.published_at),
    platformUrl: r.platform_url ?? null,
    deploymentNotes: r.deployment_notes ?? null,
    supersededAt: iso(r.superseded_at),
    rolledBackAt: iso(r.rolled_back_at),
    rolledBackBy: r.rolled_back_by ?? null,
    rollbackReason: r.rollback_reason ?? null,
    withdrawnAt: iso(r.withdrawn_at),
    withdrawReason: r.withdraw_reason ?? null,
    ...(withSnapshot ? { snapshot: r.snapshot_json } : {}),
  };
}

export function mapCandidate(r) {
  return {
    id: r.id,
    runId: r.run_id,
    courseId: r.course_id,
    fullName: r.full_name,
    email: r.email ?? null,
    phone: r.phone ?? null,
    source: r.source,
    profileUrl: r.profile_url ?? null,
    yearsExperience: r.years_experience ?? null,
    status: r.status,
    assessment: r.assessment_json ?? {},
    notes: r.notes ?? '',
    linkedUserId: r.linked_user_id ?? null,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function mapTemplateVersion(r, { withDefinition = false } = {}) {
  return {
    id: r.id,
    scenario: r.scenario,
    versionNumber: r.version_number,
    codeVersion: r.code_version,
    options: r.options_json ?? {},
    checksum: r.checksum,
    notes: r.notes ?? '',
    isCurrent: Boolean(r.is_current),
    createdBy: r.created_by ?? null,
    createdAt: iso(r.created_at),
    retiredAt: iso(r.retired_at),
    ...(withDefinition ? { definition: r.definition_json } : {}),
  };
}
