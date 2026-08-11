/**
 * Named responsibilities in Marketing's two-step approval lane.
 *
 * The names are used only once, by the boot migration, to attach a durable
 * workflow role to the existing accounts. Runtime authorisation never trusts a
 * display name: changing a person's name cannot grant access, and the role
 * remains stable after the migration has identified the account.
 */
export const TASK_WORKFLOW_ROLES = {
  MARKETING_REVIEWER: 'marketing_reviewer',
  MARKETING_FINAL_APPROVER: 'marketing_final_approver',
};

/** Version of the one-time permission defaults attached to those legacy desks. */
export const TASK_WORKFLOW_PERMISSION_VERSION = 1;

const REVIEWER_NAMES = new Set(['ميرنا', 'mirna', 'merna']);
const FINAL_APPROVER_NAMES = new Set([
  'صديق',
  'صادق',
  'seddik',
  'sedik',
  'sadeek',
  'sadeq',
  'sadek',
  'sadiq',
  'sadik',
]);

function nameTokens(value) {
  return String(value || '')
    .toLocaleLowerCase('en')
    .normalize('NFKD')
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Infer roles for the named existing accounts during deployment migration. */
export function inferredMarketingWorkflowRoles(user) {
  if (user?.department !== 'marketing') return [];
  const tokens = nameTokens(user.name);
  const roles = [];
  if (tokens.some((token) => REVIEWER_NAMES.has(token))) {
    roles.push(TASK_WORKFLOW_ROLES.MARKETING_REVIEWER);
  }
  if (tokens.some((token) => FINAL_APPROVER_NAMES.has(token))) {
    roles.push(TASK_WORKFLOW_ROLES.MARKETING_FINAL_APPROVER);
  }
  return roles;
}

export function hasTaskWorkflowRole(user, role) {
  return Array.isArray(user?.taskWorkflowRoles) && user.taskWorkflowRoles.includes(role);
}
