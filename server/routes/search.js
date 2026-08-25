import { Router } from 'express';
import { find } from '../store.js';
import { requireAuth } from '../auth.js';
import { PERMISSIONS, can, canOpenApp } from '../../shared/permissions.js';
import { DEFAULT_DEPARTMENT, stageLabel } from '../../shared/departments.js';
import { livePredicate, visiblePeople } from '../taskAccess.js';
import { officesOf, seatsOf } from '../offices.js';
import { organizationOf } from '../../shared/organization.js';
import { seatState } from '../../shared/offices.js';

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
    const tasks = await find('tasks', livePredicate(req.user));
    for (const task of tasks) {
      if (
        !matches(
          task.reference,
          task.title,
          task.description,
          task.objective,
          task.definitionOfDone,
          ...(task.labels || [])
        )
      ) continue;
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
    const users = visiblePeople(req.user, await find('users'));
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

  // Rooms and desks. No permission gate — the seating plan is readable by
  // anybody with a session, and "where does she sit" is the question this box
  // is most often opened for. A desk matches on the name written on it, so
  // searching a colleague finds their desk even when they have no account.
  {
    const organizationId = organizationOf(req.user);
    const [offices, seats] = await Promise.all([officesOf(organizationId), seatsOf(organizationId)]);
    const roomById = new Map(offices.map((office) => [office.id, office]));

    for (const office of offices) {
      if (!matches(office.nameAr, office.nameEn, office.zone)) continue;
      const mine = seats.filter((seat) => seat.officeId === office.id);
      const free = mine.filter((seat) => seatState(seat) === 'free').length;
      results.push({
        type: 'office',
        id: office.id,
        title: lang === 'en' && office.nameEn ? office.nameEn : office.nameAr,
        subtitle:
          lang === 'en'
            ? `${office.zone} · ${free} of ${mine.length} available`
            : `${office.zone} · ${free} متاحة من ${mine.length}`,
        route: '/offices',
      });
    }

    // Indexed once rather than a store read per desk — a hundred desks would
    // otherwise be a hundred scans of the users collection on every keystroke.
    const everyone = new Map(
      (await find('users', (u) => organizationOf(u) === organizationId)).map((u) => [u.id, u])
    );
    for (const seat of seats) {
      const person = seat.userId ? everyone.get(seat.userId) : null;
      const name = person?.name ?? seat.occupantName;
      if (!name || !matches(name)) continue;
      const office = roomById.get(seat.officeId);
      if (!office) continue;
      results.push({
        type: 'seat',
        id: seat.id,
        title: name,
        subtitle:
          lang === 'en'
            ? `Desk ${seat.label} · ${office.nameEn || office.nameAr} · ${office.zone}`
            : `وحدة ${seat.label} · ${office.nameAr} · ${office.zone}`,
        route: '/offices',
      });
    }
  }

  // Apps first — a launcher's job is launching.
  const weight = { app: 0, seat: 1, office: 2, task: 3, user: 4 };
  results.sort((a, b) => {
    const exact = Number(b.title.toLowerCase().startsWith(query)) -
      Number(a.title.toLowerCase().startsWith(query));
    return exact || weight[a.type] - weight[b.type];
  });

  res.json({ query, results: results.slice(0, 25) });
});

export default router;
