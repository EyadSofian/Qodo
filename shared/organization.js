/**
 * Tenant identity.
 *
 * The workspace started as a single-company product, so legacy documents do
 * not carry an organization id. Keeping the fallback in one shared module lets
 * the boot migration add the field without weakening request-time isolation.
 */
export const DEFAULT_ORGANIZATION_ID = 'engosoft';

export function organizationOf(record) {
  return record?.organizationId ?? DEFAULT_ORGANIZATION_ID;
}

export function sameOrganization(left, right) {
  return organizationOf(left) === organizationOf(right);
}
