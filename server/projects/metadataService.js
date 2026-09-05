/**
 * Qodo Projects — the metadata engine.
 *
 * Modules, statuses, layouts and custom fields are data, not React forms and
 * not `switch` statements. One engine serves projects, phases, task lists,
 * tasks, issues and any custom module an administrator defines.
 *
 * This ships early rather than late (ADR-4) because the live audit found that
 * Zoho Projects "Infinity" is *built around* custom modules — they carry their
 * own layouts, rules, reports and automation. Writing eight hardcoded modules
 * and retrofitting a metadata engine underneath them afterwards is the single
 * most expensive mistake available here.
 *
 * What this deliberately is not: executable. Field types are a closed set,
 * validation is declarative, and nothing stored here is ever evaluated as code.
 */

import { query, rows, row, transaction } from './db.js';
import * as audit from './auditService.js';

/**
 * The modules every organization starts with.
 *
 * Rows rather than constants because Zoho lets an administrator rename Tasks,
 * Issues and Phases organization-wide, and a company that calls them
 * "Deliverables" and "Defects" should see those words everywhere — including in
 * reports. A renameable label has to be data.
 */
export const BUILT_IN_MODULES = [
  { key: 'project', labelAr: 'مشروع', labelEn: 'Project', pluralAr: 'مشاريع', pluralEn: 'Projects', icon: 'folder-kanban' },
  { key: 'phase', labelAr: 'مرحلة', labelEn: 'Phase', pluralAr: 'مراحل', pluralEn: 'Phases', icon: 'layers' },
  { key: 'task_list', labelAr: 'قائمة مهام', labelEn: 'Task list', pluralAr: 'قوائم المهام', pluralEn: 'Task lists', icon: 'list' },
  { key: 'task', labelAr: 'مهمة', labelEn: 'Task', pluralAr: 'مهام', pluralEn: 'Tasks', icon: 'list-checks' },
  { key: 'issue', labelAr: 'مشكلة', labelEn: 'Issue', pluralAr: 'مشاكل', pluralEn: 'Issues', icon: 'bug' },
  { key: 'time_log', labelAr: 'تسجيل وقت', labelEn: 'Time log', pluralAr: 'تسجيلات الوقت', pluralEn: 'Time logs', icon: 'clock' },
];

/**
 * The statuses a new organization gets, per module.
 *
 * Chosen so the product works the moment it is opened rather than presenting an
 * empty board and a configuration screen. `category` is what the code branches
 * on — a company renaming "Done" to "Handed over" must not break a report.
 */
export const DEFAULT_STATUSES = {
  project: [
    { key: 'planning', ar: 'قيد التخطيط', en: 'Planning', color: '#64748B', category: 'open', isDefault: true },
    { key: 'active', ar: 'جارٍ التنفيذ', en: 'Active', color: '#1D6FB8', category: 'active' },
    { key: 'on_hold', ar: 'متوقّف', en: 'On hold', color: '#F59E0B', category: 'open' },
    { key: 'completed', ar: 'مكتمل', en: 'Completed', color: '#16A34A', category: 'done' },
    { key: 'cancelled', ar: 'ملغى', en: 'Cancelled', color: '#94A3B8', category: 'cancelled' },
  ],
  phase: [
    { key: 'not_started', ar: 'لم تبدأ', en: 'Not started', color: '#64748B', category: 'open', isDefault: true },
    { key: 'in_progress', ar: 'جارية', en: 'In progress', color: '#1D6FB8', category: 'active' },
    { key: 'completed', ar: 'مكتملة', en: 'Completed', color: '#16A34A', category: 'done' },
  ],
  task: [
    { key: 'open', ar: 'مفتوحة', en: 'Open', color: '#64748B', category: 'open', isDefault: true },
    { key: 'in_progress', ar: 'جارية', en: 'In progress', color: '#1D6FB8', category: 'active' },
    { key: 'in_review', ar: 'قيد المراجعة', en: 'In review', color: '#7C3AED', category: 'review' },
    { key: 'done', ar: 'مكتملة', en: 'Done', color: '#16A34A', category: 'done' },
  ],
  issue: [
    { key: 'open', ar: 'مفتوحة', en: 'Open', color: '#DC2626', category: 'open', isDefault: true },
    { key: 'in_progress', ar: 'جارٍ الإصلاح', en: 'Being fixed', color: '#1D6FB8', category: 'active' },
    { key: 'to_verify', ar: 'في انتظار التحقق', en: 'To verify', color: '#7C3AED', category: 'review' },
    { key: 'closed', ar: 'مغلقة', en: 'Closed', color: '#16A34A', category: 'done' },
    { key: 'wont_fix', ar: 'لن تُعالج', en: 'Won’t fix', color: '#94A3B8', category: 'cancelled' },
  ],
};

/**
 * Give an organization its modules and statuses, once.
 *
 * Idempotent, so it can run on every boot: `ON CONFLICT DO NOTHING` means a
 * status an administrator has since renamed or retired is never resurrected by
 * a restart.
 */
export async function ensureDefaults(organizationId) {
  return transaction(async (tx) => {
    const moduleIds = new Map();

    for (const [index, module] of BUILT_IN_MODULES.entries()) {
      const created = await tx.row(
        `INSERT INTO qodo_projects.modules
           (organization_id, key, label_ar, label_en, plural_ar, plural_en, icon, order_index)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (organization_id, key) DO UPDATE SET key = EXCLUDED.key
         RETURNING id, key`,
        [
          organizationId,
          module.key,
          module.labelAr,
          module.labelEn,
          module.pluralAr,
          module.pluralEn,
          module.icon,
          index,
        ]
      );
      moduleIds.set(created.key, created.id);
    }

    for (const [moduleKey, statuses] of Object.entries(DEFAULT_STATUSES)) {
      const moduleId = moduleIds.get(moduleKey);
      if (!moduleId) continue;
      for (const [index, status] of statuses.entries()) {
        await tx.query(
          `INSERT INTO qodo_projects.statuses
             (organization_id, module_id, key, label_ar, label_en, color, category, order_index, is_default)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (module_id, key) DO NOTHING`,
          [
            organizationId,
            moduleId,
            status.key,
            status.ar,
            status.en,
            status.color,
            status.category,
            index,
            Boolean(status.isDefault),
          ]
        );
      }
    }

    return [...moduleIds.keys()];
  });
}

/* ------------------------------------------------------------------ */
/* Modules                                                              */
/* ------------------------------------------------------------------ */

export async function modulesFor(organizationId) {
  return (
    await rows(
      `SELECT id, key, label_ar, label_en, plural_ar, plural_en, icon, color,
              is_custom, is_enabled, project_id, order_index
         FROM qodo_projects.modules
        WHERE organization_id = $1
        ORDER BY order_index, key`,
      [organizationId]
    )
  ).map((record) => ({
    id: record.id,
    key: record.key,
    label: { ar: record.label_ar, en: record.label_en },
    plural: { ar: record.plural_ar, en: record.plural_en },
    icon: record.icon,
    color: record.color,
    isCustom: record.is_custom,
    isEnabled: record.is_enabled,
    projectId: record.project_id,
  }));
}

export async function moduleIdFor(organizationId, key) {
  const found = await row(
    'SELECT id FROM qodo_projects.modules WHERE organization_id = $1 AND key = $2',
    [organizationId, key]
  );
  return found?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Statuses                                                             */
/* ------------------------------------------------------------------ */

export async function statusesFor(organizationId, moduleKey) {
  const params = [organizationId];
  let filter = '';
  if (moduleKey) {
    params.push(moduleKey);
    filter = `AND m.key = $${params.length}`;
  }

  return (
    await rows(
      `SELECT s.id, s.key, s.label_ar, s.label_en, s.color, s.category,
              s.order_index, s.is_active, s.is_default, m.key AS module_key
         FROM qodo_projects.statuses s
         JOIN qodo_projects.modules m ON m.id = s.module_id
        WHERE s.organization_id = $1 ${filter}
        ORDER BY m.order_index, s.order_index`,
      params
    )
  ).map((record) => ({
    id: record.id,
    key: record.key,
    moduleKey: record.module_key,
    label: { ar: record.label_ar, en: record.label_en },
    color: record.color,
    category: record.category,
    orderIndex: record.order_index,
    isActive: record.is_active,
    isDefault: record.is_default,
  }));
}

export async function createStatus(user, organizationId, input) {
  const moduleId = await moduleIdFor(organizationId, input?.module);
  if (!moduleId) throw badRequest('module_not_found');

  const key = String(input?.key ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!key) throw badRequest('key_required');
  if (!['open', 'active', 'review', 'done', 'cancelled'].includes(input?.category)) {
    throw badRequest('category_invalid');
  }

  const created = await row(
    `INSERT INTO qodo_projects.statuses
       (organization_id, module_id, key, label_ar, label_en, color, category, order_index)
     VALUES ($1,$2,$3,$4,$5,$6,$7,
       (SELECT COALESCE(max(order_index), -1) + 1 FROM qodo_projects.statuses WHERE module_id = $2))
     RETURNING *`,
    [
      organizationId,
      moduleId,
      key,
      String(input?.labelAr ?? input?.labelEn ?? key),
      String(input?.labelEn ?? input?.labelAr ?? key),
      input?.color ?? '#64748B',
      input.category,
    ]
  );

  await audit.record({
    actor: user,
    organizationId,
    entityType: 'status',
    entityId: created.id,
    action: 'status.create',
    after: { key, module: input.module, category: created.category },
  });

  return created;
}

/**
 * Change a status.
 *
 * `key` and `category` are absent from what may be edited. The key is what
 * historical rows point at, and the category is what every report branches on —
 * changing either would silently rewrite the meaning of records that were
 * closed months ago. Retiring a status (`isActive: false`) is how you take one
 * out of use without touching history (§32).
 */
export async function updateStatus(user, organizationId, statusId, input) {
  const assignments = [];
  const params = [statusId, organizationId];

  for (const [field, column] of Object.entries({
    labelAr: 'label_ar',
    labelEn: 'label_en',
    color: 'color',
    orderIndex: 'order_index',
    isActive: 'is_active',
  })) {
    if (input?.[field] === undefined) continue;
    params.push(field === 'isActive' ? Boolean(input[field]) : input[field]);
    assignments.push(`${column} = $${params.length}`);
  }
  if (assignments.length === 0) return null;

  const updated = await row(
    `UPDATE qodo_projects.statuses SET ${assignments.join(', ')}
      WHERE id = $1 AND organization_id = $2 RETURNING *`,
    params
  );
  if (!updated) return null;

  await audit.record({
    actor: user,
    organizationId,
    entityType: 'status',
    entityId: statusId,
    action: 'status.update',
    after: { isActive: updated.is_active, label: updated.label_en },
  });

  return updated;
}

/* ------------------------------------------------------------------ */
/* Custom fields                                                        */
/* ------------------------------------------------------------------ */

export const FIELD_TYPES = [
  'text', 'textarea', 'richtext', 'integer', 'decimal', 'currency', 'percent',
  'checkbox', 'select', 'multiselect', 'radio', 'date', 'datetime', 'email',
  'phone', 'url', 'user', 'multiuser', 'lookup', 'summary', 'connect',
];

export async function fieldsFor(organizationId, moduleKey) {
  const params = [organizationId];
  let filter = '';
  if (moduleKey) {
    params.push(moduleKey);
    filter = `AND m.key = $${params.length}`;
  }

  return (
    await rows(
      `SELECT f.*, m.key AS module_key
         FROM qodo_projects.custom_fields f
         JOIN qodo_projects.modules m ON m.id = f.module_id
        WHERE f.organization_id = $1 AND f.is_active ${filter}
        ORDER BY f.order_index, f.key`,
      params
    )
  ).map(toField);
}

function toField(record) {
  return {
    id: record.id,
    key: record.key,
    moduleKey: record.module_key,
    label: { ar: record.label_ar, en: record.label_en },
    type: record.type,
    isRequired: record.is_required,
    defaultValue: record.default_value,
    options: record.options,
    validation: record.validation,
    permissions: record.permissions,
    orderIndex: record.order_index,
  };
}

export async function createField(user, organizationId, input) {
  const moduleId = await moduleIdFor(organizationId, input?.module);
  if (!moduleId) throw badRequest('module_not_found');
  if (!FIELD_TYPES.includes(input?.type)) throw badRequest('field_type_invalid');

  const key = String(input?.key ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!key) throw badRequest('key_required');

  const created = await row(
    `INSERT INTO qodo_projects.custom_fields
       (organization_id, module_id, key, label_ar, label_en, type, is_required,
        default_value, options, validation, permissions, order_index, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
       (SELECT COALESCE(max(order_index), -1) + 1 FROM qodo_projects.custom_fields WHERE module_id = $2),
       $12)
     RETURNING *`,
    [
      organizationId,
      moduleId,
      key,
      String(input?.labelAr ?? input?.labelEn ?? key),
      String(input?.labelEn ?? input?.labelAr ?? key),
      input.type,
      Boolean(input?.isRequired),
      input?.defaultValue === undefined ? null : JSON.stringify(input.defaultValue),
      JSON.stringify(input?.options ?? {}),
      JSON.stringify(input?.validation ?? {}),
      JSON.stringify(input?.permissions ?? {}),
      user.id,
    ]
  );

  await audit.record({
    actor: user,
    organizationId,
    entityType: 'custom_field',
    entityId: created.id,
    action: 'field.create',
    after: { key, module: input.module, type: created.type },
  });

  return toField({ ...created, module_key: input.module });
}

/**
 * Read the custom-field values for a set of records.
 *
 * One query for many entities, because the alternative — a query per record —
 * is the N+1 that turns a fifty-row table into fifty-one round trips.
 */
export async function valuesFor(entityType, entityIds) {
  if (entityIds.length === 0) return new Map();

  const found = await rows(
    `SELECT v.entity_id, f.key, v.value
       FROM qodo_projects.custom_field_values v
       JOIN qodo_projects.custom_fields f ON f.id = v.field_id
      WHERE v.entity_type = $1 AND v.entity_id = ANY($2::text[]) AND f.is_active`,
    [entityType, entityIds]
  );

  const grouped = new Map();
  for (const record of found) {
    if (!grouped.has(record.entity_id)) grouped.set(record.entity_id, {});
    grouped.get(record.entity_id)[record.key] = record.value;
  }
  return grouped;
}

/**
 * Write custom-field values, validating each against its own definition.
 *
 * Validation happens here rather than in the browser because a required field
 * enforced only in React is not enforced — an automation, an import or a raw
 * API call all reach this and none of them run the form.
 */
export async function setValues(user, organizationId, entityType, entityId, values) {
  const definitions = await rows(
    `SELECT f.id, f.key, f.type, f.is_required, f.validation
       FROM qodo_projects.custom_fields f
      WHERE f.organization_id = $1 AND f.is_active AND f.key = ANY($2::text[])`,
    [organizationId, Object.keys(values ?? {})]
  );

  const problems = [];
  for (const definition of definitions) {
    const value = values[definition.key];
    const failure = validate(definition, value);
    if (failure) problems.push({ field: definition.key, error: failure });
  }
  if (problems.length > 0) {
    throw Object.assign(new Error('field_validation_failed'), {
      status: 400,
      body: { error: 'field_validation_failed', problems },
    });
  }

  for (const definition of definitions) {
    await query(
      `INSERT INTO qodo_projects.custom_field_values
         (field_id, organization_id, entity_type, entity_id, value, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (field_id, entity_id)
         DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [definition.id, organizationId, entityType, entityId, JSON.stringify(values[definition.key] ?? null), user.id]
    );
  }

  return definitions.length;
}

/** One value against one field definition. Returns a reason, or null. */
export function validate(definition, value) {
  const empty = value === null || value === undefined || value === '';
  if (definition.is_required && empty) return 'required';
  if (empty) return null;

  const rules = definition.validation ?? {};

  switch (definition.type) {
    case 'integer':
      if (!Number.isInteger(Number(value))) return 'not_an_integer';
      break;
    case 'decimal':
    case 'currency':
    case 'percent':
      if (Number.isNaN(Number(value))) return 'not_a_number';
      if (definition.type === 'percent' && (Number(value) < 0 || Number(value) > 100)) return 'out_of_range';
      break;
    case 'email':
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value))) return 'not_an_email';
      break;
    case 'url':
      if (!/^https?:\/\//i.test(String(value))) return 'not_a_url';
      break;
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return 'not_a_date';
      break;
    case 'checkbox':
      if (typeof value !== 'boolean') return 'not_a_boolean';
      break;
    case 'multiselect':
    case 'multiuser':
      if (!Array.isArray(value)) return 'not_a_list';
      break;
    default:
      break;
  }

  if (rules.min !== undefined && Number(value) < Number(rules.min)) return 'below_minimum';
  if (rules.max !== undefined && Number(value) > Number(rules.max)) return 'above_maximum';
  if (rules.maxLength !== undefined && String(value).length > Number(rules.maxLength)) return 'too_long';
  if (rules.pattern !== undefined) {
    try {
      if (!new RegExp(rules.pattern).test(String(value))) return 'pattern_mismatch';
    } catch {
      // A stored pattern that will not compile is a configuration error, not a
      // reason to reject the value somebody typed.
      return null;
    }
  }

  return null;
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
