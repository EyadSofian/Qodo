# Review and Approval

## Implemented

- dedicated submit-for-review action;
- at least one deliverable required;
- submission actor, time and note;
- manager-only approval;
- 0–100 score required on approval;
- written reason required for changes requested;
- rework count and resubmission;
- employee/coworker score privacy.

## Not implemented

Review rounds are not separate immutable entities. Structured feedback,
annotations, multiple approval stages, delegated approvers, client approval,
asset version binding and outdated-version warnings do not exist.

Do not grant client access to the current comment/file model; it has no
internal-versus-client visibility boundary yet.
