import { Router } from 'express';
import { find } from '../store.js';
import { requireAuth } from '../auth.js';
import { PERMISSIONS, can, canOpenApp } from '../../shared/permissions.js';
import { DEFAULT_DEPARTMENT, stageLabel } from '../../shared/departments.js';

const router = Router();
router.use(requireAuth);

/**
 * One search box over everything the hub itself knows: app tiles, tasks and
 * (with permission) people. Each result carries the route that opens it, so the
 * command palette can act on a result without a second round trip.
 *
 * Data that lives inside the sibling dashboards is not searched here — that
 * needs a read API from each one. docs/SSO.md sketches the contract.
 */
router.get('/', async (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase();
  if (query.length < 1) return res.json({ results: [], query: '' });

  const lang = req.query.lang === 'en' ? 'en' : 'ar';
  const results = [];
  const matches = (...fields) =>
    fields.some((f) => String(f || '').toLowerCase().includes(query));

  const apps = await find('apps', (a) => a.enabled !== false);
  for (const app of apps) {
    if (!canOpenApp(req.user, app.id)) continue;
    if (app.requires && !can(req.user, app.requires)) continue;
    if (!matches(app.nameAr, app.nameEn, app.descAr, app.id)) continue;
    results.push({
      type: 'app',
      id: app.id,
      title: lang === 'en' && app.nameEn ? app.nameEn : app.nameAr,
      subtitle: lang === 'en' ? app.descAr : app.nameEn || app.descAr,
      icon: app.icon,
      color: app.color,
      route: app.kind === 'internal' ? app.url : `/app/${app.id}`,
    });
  }

  if (can(req.user, PERMISSIONS.TASKS_VIEW)) {
    const seesAll = can(req.user, PERMISSIONS.TASKS_VIEW_ALL);
    const tasks = await find(
      'tasks',
      (t) => seesAll || t.assigneeId === req.user.id || t.createdBy === req.user.id
    );
    for (const task of tasks) {
      if (!matches(task.title, task.description, ...(task.labels || []))) continue;
      const department = task.department ?? DEFAULT_DEPARTMENT;
      results.push({
        type: 'task',
        id: task.id,
        title: task.title,
        subtitle: stageLabel(department, task.stage, lang),
        department,
        stage: task.stage,
        priority: task.priority,
        route: `/tasks?task=${task.id}`,
      });
    }
  }

  if (can(req.user, PERMISSIONS.USERS_VIEW)) {
    const users = await find('users');
    for (const user of users) {
      if (!matches(user.name, user.email, user.title)) continue;
      results.push({
        type: 'user',
        id: user.id,
        title: user.name,
        subtitle: user.email,
        color: user.avatarColor,
        route: `/users?user=${user.id}`,
      });
    }
  }

  // Apps first — a launcher's job is launching.
  const weight = { app: 0, task: 1, user: 2 };
  results.sort((a, b) => {
    const exact = Number(b.title.toLowerCase().startsWith(query)) -
      Number(a.title.toLowerCase().startsWith(query));
    return exact || weight[a.type] - weight[b.type];
  });

  res.json({ query, results: results.slice(0, 25) });
});

export default router;
