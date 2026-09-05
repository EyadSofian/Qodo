/**
 * Qodo Projects — dashboards.
 *
 * A dashboard is a layout plus a set of widgets, and a widget is either a saved
 * report or an inline definition. Pointing at a saved report is usually what
 * somebody wants: editing the report then updates every dashboard showing it,
 * rather than leaving six stale copies of the same chart.
 *
 * Widget data is resolved through `reportService`, which means a widget cannot
 * see anything its owner could not see by running the report by hand — the
 * dashboard adds a layout, never reach.
 */

import { query, rows, row, transaction } from './db.js';
import * as reports from './reportService.js';

/** The widget kinds the product knows how to draw. A closed set. */
export const WIDGET_TYPES = [
  'report',
  'stat',
  'task_status',
  'issue_status',
  'overdue',
  'workload',
  'budget',
  'recent_activity',
];

export async function list(user, organizationId, projectId = null) {
  return (
    await rows(
      `SELECT d.*, count(w.id)::int AS widget_count
         FROM qodo_projects.dashboards d
         LEFT JOIN qodo_projects.dashboard_widgets w ON w.dashboard_id = d.id
        WHERE d.organization_id = $1
          AND (d.project_id = $2 OR ($2::uuid IS NULL AND d.project_id IS NULL))
          AND (d.owner_id = $3
               OR d.visibility IN ('organization', 'project')
               OR (d.visibility = 'shared' AND d.shared_with @> $4::jsonb))
        GROUP BY d.id
        ORDER BY d.is_default DESC, d.name`,
      [organizationId, projectId, user.id, JSON.stringify([user.id])]
    )
  ).map((record) => ({
    id: record.id,
    name: record.name,
    description: record.description,
    projectId: record.project_id,
    visibility: record.visibility,
    ownerId: record.owner_id,
    isDefault: record.is_default,
    isMine: record.owner_id === user.id,
    widgetCount: record.widget_count,
  }));
}

export async function create(user, organizationId, input) {
  const name = String(input?.name ?? '').trim();
  if (!name) throw badRequest('name_required');

  const created = await row(
    `INSERT INTO qodo_projects.dashboards
       (organization_id, project_id, name, description, visibility, shared_with, owner_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      organizationId,
      input?.projectId ?? null,
      name,
      String(input?.description ?? ''),
      ['private', 'shared', 'project', 'organization'].includes(input?.visibility)
        ? input.visibility
        : 'private',
      JSON.stringify(input?.sharedWith ?? []),
      user.id,
    ]
  );

  return { id: created.id, name: created.name };
}

export async function addWidget(user, organizationId, dashboardId, input) {
  if (!WIDGET_TYPES.includes(input?.type)) throw badRequest('widget_type_unknown');

  const owned = await row(
    'SELECT id FROM qodo_projects.dashboards WHERE id = $1 AND organization_id = $2 AND owner_id = $3',
    [dashboardId, organizationId, user.id]
  );
  // Editing somebody else's dashboard is not a thing you do by having its link.
  if (!owned) return null;

  const created = await row(
    `INSERT INTO qodo_projects.dashboard_widgets
       (dashboard_id, organization_id, type, title, report_id, config, position, order_index)
     VALUES ($1,$2,$3,$4,$5,$6,$7,
       (SELECT COALESCE(max(order_index), -1) + 1 FROM qodo_projects.dashboard_widgets WHERE dashboard_id = $1))
     RETURNING *`,
    [
      dashboardId,
      organizationId,
      input.type,
      String(input?.title ?? ''),
      input?.reportId ?? null,
      JSON.stringify(input?.config ?? {}),
      JSON.stringify(input?.position ?? { x: 0, y: 0, w: 4, h: 3 }),
    ]
  );

  return { id: created.id, type: created.type, position: created.position };
}

/**
 * Move and resize widgets in one statement.
 *
 * A drag produces a whole new layout, so the API takes one. Applying it as N
 * updates lets a concurrent add land between them and leaves two widgets on the
 * same square.
 */
export async function setLayout(user, organizationId, dashboardId, layout) {
  const owned = await row(
    'SELECT id FROM qodo_projects.dashboards WHERE id = $1 AND organization_id = $2 AND owner_id = $3',
    [dashboardId, organizationId, user.id]
  );
  if (!owned) return null;

  await transaction(async (tx) => {
    for (const [index, entry] of (layout ?? []).entries()) {
      await tx.query(
        `UPDATE qodo_projects.dashboard_widgets
            SET position = $3, order_index = $4
          WHERE id = $1 AND dashboard_id = $2`,
        [entry.id, dashboardId, JSON.stringify(entry.position ?? {}), index]
      );
    }
  });

  return { updated: (layout ?? []).length };
}

export async function removeWidget(user, organizationId, dashboardId, widgetId) {
  const { rowCount } = await query(
    `DELETE FROM qodo_projects.dashboard_widgets w
      USING qodo_projects.dashboards d
      WHERE w.id = $1 AND w.dashboard_id = $2 AND d.id = w.dashboard_id
        AND d.organization_id = $3 AND d.owner_id = $4`,
    [widgetId, dashboardId, organizationId, user.id]
  );
  return rowCount > 0;
}

/**
 * A dashboard with its widgets' data already resolved.
 *
 * One round trip for the whole board, and every widget's data goes through the
 * report engine — so a widget shows what its viewer may see, not what its
 * author could.
 */
export async function render(user, context, organizationId, dashboardId) {
  const dashboard = await row(
    `SELECT * FROM qodo_projects.dashboards
      WHERE id = $1 AND organization_id = $2
        AND (owner_id = $3 OR visibility IN ('organization', 'project')
             OR (visibility = 'shared' AND shared_with @> $4::jsonb))`,
    [dashboardId, organizationId, user.id, JSON.stringify([user.id])]
  );
  if (!dashboard) return null;

  const widgets = await rows(
    `SELECT w.*, r.definition AS report_definition, r.name AS report_name
       FROM qodo_projects.dashboard_widgets w
       LEFT JOIN qodo_projects.saved_reports r ON r.id = w.report_id
      WHERE w.dashboard_id = $1
      ORDER BY w.order_index`,
    [dashboardId]
  );

  const resolved = [];
  for (const widget of widgets) {
    let data = null;
    let error = null;
    try {
      const definition = widget.report_definition ?? widget.config?.definition ?? null;
      if (definition) data = await reports.run(user, context, definition);
    } catch (caught) {
      // One broken widget must not take the board down — it reports its own
      // failure and the rest of the dashboard still renders.
      error = caught.body?.error ?? 'widget_failed';
    }

    resolved.push({
      id: widget.id,
      type: widget.type,
      title: widget.title || widget.report_name || '',
      position: widget.position,
      data,
      error,
    });
  }

  return {
    id: dashboard.id,
    name: dashboard.name,
    projectId: dashboard.project_id,
    isMine: dashboard.owner_id === user.id,
    widgets: resolved,
  };
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
