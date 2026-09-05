/**
 * Qodo Projects — the global search source.
 *
 * Plugs into the workspace's existing `Ctrl/Cmd + K` palette rather than adding
 * a second search box. Everything it returns is filtered by membership first:
 * a search result naming a project you cannot open has already told you it
 * exists, which is the whole reason §62 says "permission-filtered results only".
 */

import { rows } from './db.js';
import { visibleProjectIds } from './projectAccess.js';
import { find } from '../store.js';

/** How many results one source may contribute. The palette shows a handful. */
const PER_TYPE = 5;

export async function searchProjects(user, query, lang = 'ar') {
  const needle = String(query ?? '').trim().toLowerCase();
  if (needle.length < 2) return [];

  const projectIds = await visibleProjectIds(user);
  if (projectIds.length === 0) return [];

  const pattern = `%${needle}%`;
  const results = [];

  const projects = await rows(
    `SELECT p.id, p.key, p.name, s.label_ar AS status_ar, s.label_en AS status_en, p.color
       FROM qodo_projects.projects p
       LEFT JOIN qodo_projects.statuses s ON s.id = p.status_id
      WHERE p.id = ANY($1::uuid[]) AND p.deleted_at IS NULL
        AND (lower(p.name) LIKE $2 OR lower(p.key) LIKE $2)
      ORDER BY p.updated_at DESC LIMIT $3`,
    [projectIds, pattern, PER_TYPE]
  );

  for (const project of projects) {
    results.push({
      type: 'project',
      id: project.id,
      title: project.name,
      subtitle: [project.key, lang === 'en' ? project.status_en : project.status_ar]
        .filter(Boolean)
        .join(' · '),
      icon: 'kanban',
      color: project.color,
      route: `/projects/${project.id}`,
    });
  }

  const issues = await rows(
    `SELECT i.id, i.key, i.title, i.severity, i.project_id
       FROM qodo_projects.issues i
      WHERE i.project_id = ANY($1::uuid[]) AND i.deleted_at IS NULL
        AND (lower(i.title) LIKE $2 OR lower(i.key) LIKE $2)
      ORDER BY i.created_at DESC LIMIT $3`,
    [projectIds, pattern, PER_TYPE]
  );

  for (const issue of issues) {
    results.push({
      type: 'issue',
      id: issue.id,
      title: issue.title,
      subtitle: `${issue.key} · ${issue.severity}`,
      icon: 'bug',
      color: '#DC2626',
      route: `/projects/${issue.project_id}/issues`,
    });
  }

  /**
   * Project tasks.
   *
   * Titles live in the task documents (ADR-3), so the extensions are read first
   * to establish which tasks are in reach and the documents are then filtered
   * against that set — never the other way round, which would search every task
   * in the company and filter afterwards.
   */
  const extensions = await rows(
    `SELECT t.task_id, t.project_id, p.name AS project_name
       FROM qodo_projects.project_task_extensions t
       JOIN qodo_projects.projects p ON p.id = t.project_id
      WHERE t.project_id = ANY($1::uuid[]) AND t.deleted_at IS NULL
      LIMIT 2000`,
    [projectIds]
  );

  if (extensions.length > 0) {
    const byId = new Map(extensions.map((task) => [task.task_id, task]));
    const documents = await find(
      'tasks',
      (task) =>
        byId.has(task.id) &&
        (String(task.title ?? '').toLowerCase().includes(needle) ||
          String(task.reference ?? '').toLowerCase().includes(needle))
    );

    for (const document of documents.slice(0, PER_TYPE)) {
      const extension = byId.get(document.id);
      results.push({
        type: 'task',
        id: document.id,
        title: document.title,
        subtitle: `${document.reference} · ${extension.project_name}`,
        icon: 'list-checks',
        color: '#1D6FB8',
        route: `/projects/${extension.project_id}/tasks`,
      });
    }
  }

  const documents = await rows(
    `SELECT f.id, f.name, f.project_id, p.name AS project_name
       FROM qodo_projects.document_files f
       JOIN qodo_projects.projects p ON p.id = f.project_id
      WHERE f.project_id = ANY($1::uuid[]) AND f.deleted_at IS NULL
        AND lower(f.name) LIKE $2
      ORDER BY f.updated_at DESC LIMIT $3`,
    [projectIds, pattern, PER_TYPE]
  );

  for (const file of documents) {
    results.push({
      type: 'document',
      id: file.id,
      title: file.name,
      subtitle: file.project_name,
      icon: 'file-text',
      color: '#64748B',
      route: `/projects/${file.project_id}/documents`,
    });
  }

  return results;
}
