/**
 * Qodo Projects — loading and removing the demo data.
 *
 * The content is in `demoBlueprint.js`. This file is the engine, and the whole
 * of its design is about one question: how do you write believable data into
 * the same tables as real work without ever being able to damage the real work?
 *
 * Four answers, in the order they matter.
 *
 * **It never runs by itself.** Nothing here is called from `seed.js`, from the
 * scheduler, or from any code path that a deploy or a restart reaches. The only
 * entry point is an authenticated request from somebody holding an
 * administrator's permission set. A production database that nobody asks will
 * never contain a row from this file.
 *
 * **It deletes a list, not a pattern.** Every row the loader creates is written
 * to `demo_seeds` in the same transaction, and the unloader reads that list
 * back. It does not search for projects called "إطلاق متجر إلكتروني" or
 * customers called "شركة النور الرقمية", because a company that liked the demo
 * enough to name a real project after it would lose that project. If a row is
 * not in the manifest, this module will not touch it.
 *
 * **The demo staff cannot sign in.** The six people are real `users` rows —
 * there is no way to fake a user id that the members list, the workload report
 * and the assignee picker would all accept. They are created with
 * `status: 'inactive'` and `passwordHash: null`, which means `verifyPassword`
 * compares against an empty hash and always fails, `isActiveUser` is false so
 * the login route refuses them anyway, and `candidates()` filters them out of
 * the picker on real projects. Their addresses are on the reserved `.invalid`
 * domain, which cannot be registered, so no notification can ever leave the
 * building.
 *
 * **It refuses to load twice.** A second load would double the users and leave
 * two batches whose removal order matters. It answers 409 and says to remove
 * the existing set first.
 *
 * One consequence worth stating plainly rather than discovering: a project task
 * is a workspace task (ADR-3), so demo tasks appear on the department board in
 * /tasks as well as inside the project. That is not a leak, it is the
 * architecture — and it is why the manifest records the document id of every
 * task, so removal takes both halves and leaves nothing behind in My Work.
 */

import crypto from 'node:crypto';

import { query, rows, row, transaction } from './db.js';
import { getStore, removeBlob, create as createDocument } from '../store.js';
import { organizationOf } from '../../shared/organization.js';
import { PROJECT_PERMISSIONS, permissionsOfSet } from '../../shared/projects/permissions.js';

import * as access from './projectAccess.js';
import * as audit from './auditService.js';
import * as budgetService from './budgetService.js';
import * as collaboration from './collaborationService.js';
import * as documentService from './documentService.js';
import * as issueService from './issueService.js';
import * as metadata from './metadataService.js';
import * as phaseService from './phaseService.js';
import * as projectService from './projectService.js';
import * as scheduleService from './scheduleService.js';
import * as taskListService from './taskListService.js';
import * as taskService from './taskService.js';
import * as timeService from './timeService.js';

import { CUSTOMERS, GROUPS, PEOPLE, PROJECTS, TAGS, WORK_CALENDAR, blueprintTotals } from './demoBlueprint.js';
import {
  AUTOMATION_RUNS,
  BUSINESS_RULES,
  INTEGRATIONS,
  NOTIFICATIONS,
  SAVED_REPORTS,
  SAVED_VIEWS,
  SLA_POLICIES,
  WEBHOOK_ENDPOINTS,
  WORKFLOW_RULES,
} from './demoOrgBlueprint.js';

/**
 * The domain every demo address sits on.
 *
 * `.invalid` is reserved by RFC 2606 and can never be delegated, so an address
 * here is guaranteed not to belong to a real person — now or after somebody
 * buys the domain the demo would otherwise have squatted on.
 */
export const DEMO_EMAIL_DOMAIN = 'demo.qodo.invalid';

/**
 * The deployment-level off switch.
 *
 * The permission check is the real control; this exists so an operator running
 * a production instance can take the button off the screen entirely rather than
 * trusting that nobody with an administrator's set ever clicks it. Absent means
 * on, because a developer running `npm run dev` should not need to set an
 * environment variable to see the feature exists.
 */
export function isEnabled() {
  return String(process.env.PROJECTS_DEMO_DATA ?? '').trim().toLowerCase() !== 'off';
}

/**
 * Who may load or remove the demo data.
 *
 * Two locks, and both are needed. `permissions.manage` is the Projects
 * administrator's key and no other built-in set carries it — but Projects
 * permissions are about projects, and this endpoint also creates **workspace
 * user accounts**. Granting somebody authority over Projects is not the same
 * decision as granting them authority to create logins for the company, so the
 * workspace administrator role is asked for separately.
 *
 * A pure function rather than a check inside the route, because it is the
 * security boundary for the most destructive endpoint in the module and it
 * should be assertable without standing up an HTTP server.
 */
export function mayManageDemoData(user, permissionSet) {
  if (!user || user.role !== 'admin') return false;
  return permissionsOfSet(permissionSet).includes(PROJECT_PERMISSIONS.PERMISSIONS_MANAGE);
}

/* ------------------------------------------------------------------ */
/* Dates                                                                */
/* ------------------------------------------------------------------ */

/**
 * A calendar day, `days` away from today, as `YYYY-MM-DD`.
 *
 * Built from UTC parts rather than from `toISOString()` on a local date,
 * because the second one is off by a day for everybody east of Greenwich after
 * 22:00 — which in Cairo is most of an evening, and would silently shift every
 * date in the demo.
 */
function dayFromToday(days) {
  const today = new Date();
  const utc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return new Date(utc + days * 86_400_000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* The manifest                                                         */
/* ------------------------------------------------------------------ */

/**
 * Claim one row for this batch.
 *
 * Called for everything the loader creates that the unloader will have to find
 * again. Rows that cascade from a project — phases, tasks' extensions, time
 * entries, comments — are deliberately *not* recorded individually: deleting
 * the project takes them, and a manifest listing them would be a second copy of
 * a foreign key that already exists. What is recorded is everything that would
 * otherwise survive: the projects themselves, the customers, the groups, the
 * user rows, and the task documents in the other storage engine.
 */
async function claim(tx, { organizationId, batchId, actorId, entityType, entityId }) {
  await tx.query(
    `INSERT INTO qodo_projects.demo_seeds
       (organization_id, batch_id, entity_type, entity_id, created_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (batch_id, entity_type, entity_id) DO NOTHING`,
    [organizationId, batchId, entityType, String(entityId), actorId]
  );
}

/** The same, outside a transaction, for the steps that run through a service. */
async function claimNow(context, batchId, entityType, entityId) {
  await query(
    `INSERT INTO qodo_projects.demo_seeds
       (organization_id, batch_id, entity_type, entity_id, created_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (batch_id, entity_type, entity_id) DO NOTHING`,
    [context.organizationId, batchId, entityType, String(entityId), context.user.id]
  );
}

/* ------------------------------------------------------------------ */
/* Status                                                               */
/* ------------------------------------------------------------------ */

/**
 * What is loaded right now.
 *
 * The counts come from the manifest joined back against the live tables, so a
 * project an administrator deleted by hand after loading is reported as gone
 * rather than as still present. That difference is the reason this is a query
 * rather than a stored summary.
 */
export async function status(user) {
  const organizationId = organizationOf(user);

  const batches = await rows(
    `SELECT s.batch_id,
            min(s.created_at) AS loaded_at,
            max(s.created_by) AS loaded_by,
            count(*) FILTER (WHERE s.entity_type = 'project')::int  AS projects,
            count(*) FILTER (WHERE s.entity_type = 'customer')::int AS customers,
            count(*) FILTER (WHERE s.entity_type = 'user')::int     AS people,
            count(*) FILTER (WHERE s.entity_type = 'task_document')::int AS tasks
       FROM qodo_projects.demo_seeds s
      WHERE s.organization_id = $1
      GROUP BY s.batch_id
      ORDER BY min(s.created_at) DESC`,
    [organizationId]
  );

  // How much of the most recent batch is still really there. A demo whose
  // projects were deleted one by one should not report itself as fully loaded.
  let live = null;
  if (batches.length > 0) {
    live = await row(
      `SELECT count(*)::int AS projects
         FROM qodo_projects.demo_seeds s
         JOIN qodo_projects.projects p ON p.id = s.entity_id::uuid
        WHERE s.organization_id = $1 AND s.batch_id = $2
          AND s.entity_type = 'project' AND p.deleted_at IS NULL`,
      [organizationId, batches[0].batch_id]
    );
  }

  return {
    enabled: isEnabled(),
    loaded: batches.length > 0,
    batch: batches[0]
      ? {
          id: batches[0].batch_id,
          loadedAt: batches[0].loaded_at,
          loadedBy: batches[0].loaded_by,
          counts: {
            projects: batches[0].projects,
            customers: batches[0].customers,
            people: batches[0].people,
            tasks: batches[0].tasks,
          },
          liveProjects: live?.projects ?? 0,
        }
      : null,
    // What a load *would* create, so the confirmation dialog can say so before
    // anything is written rather than after.
    willCreate: blueprintTotals(),
  };
}

/* ------------------------------------------------------------------ */
/* Loading                                                              */
/* ------------------------------------------------------------------ */

const conflict = (error, extra = {}) =>
  Object.assign(new Error(error), { status: 409, body: { error, ...extra } });

/**
 * Write the whole demo.
 *
 * Sequential rather than parallel on purpose. Each step needs ids from the one
 * before it, the total is a few hundred rows rather than a few hundred
 * thousand, and a loader that interleaved would make the audit log — which is
 * ordered by time — unreadable for anybody trying to see what it did.
 */
export async function load(user) {
  if (!isEnabled()) throw conflict('demo_data_disabled');

  const organizationId = organizationOf(user);

  /**
   * Loading twice does nothing the second time.
   *
   * The first version of this threw 409, which is defensible but wrong for the
   * thing people actually do: click the button, not see the toast, click it
   * again. An error there teaches nothing and a second batch would double every
   * user, every client and every project.
   *
   * So a load with a batch already present is a *successful no-op* that reports
   * what is there. The caller can tell the difference — `alreadyLoaded` is true
   * and `created` is empty — and the screen says "already loaded" rather than
   * pretending it just did the work. Somebody who wants it built again wants
   * `reset`, which is its own button and says so.
   */
  const existing = await row(
    'SELECT batch_id FROM qodo_projects.demo_seeds WHERE organization_id = $1 LIMIT 1',
    [organizationId]
  );
  if (existing) {
    return { alreadyLoaded: true, batchId: existing.batch_id, created: [], ...blueprintTotals() };
  }

  const batchId = crypto.randomUUID();

  // The statuses this organization actually has. The demo never creates one:
  // a company that renamed "Done" must see its own word on a demo task, and a
  // demo that invented a parallel set would prove the opposite of what it is
  // for.
  await metadata.ensureDefaults(organizationId);
  const statusIndex = new Map();
  for (const moduleKey of ['project', 'phase', 'task', 'issue']) {
    for (const status of await metadata.statusesFor(organizationId, moduleKey)) {
      statusIndex.set(`${moduleKey}:${status.key}`, status.id);
    }
  }
  const statusFor = (moduleKey, key) => statusIndex.get(`${moduleKey}:${key}`) ?? null;

  /* ── people ───────────────────────────────────────────────────── */

  const userIds = new Map();
  for (const person of PEOPLE) {
    const created = await createDocument('users', {
      name: person.name,
      email: `${person.ref}@${DEMO_EMAIL_DOMAIN}`,
      // No password, and no way to set one: the account is inactive, so the
      // login route refuses it before it ever reaches a comparison.
      passwordHash: null,
      role: 'member',
      organizationId,
      status: 'inactive',
      permissions: null,
      appIds: null,
      department: person.department,
      subteam: null,
      jobRole: null,
      title: person.title,
      avatarColor: person.avatarColor,
      lastLoginAt: null,
      // Read by the interface to badge them, and by the unloader as a
      // second check before it deletes an account.
      isDemo: true,
    });
    userIds.set(person.ref, created.id);
  }

  // Claimed in one transaction rather than one each: until these rows exist the
  // accounts above are unowned, and a crash between them would leave six demo
  // logins that no unloader knows about.
  await transaction(async (tx) => {
    for (const id of userIds.values()) {
      await claim(tx, {
        organizationId,
        batchId,
        actorId: user.id,
        entityType: 'user',
        entityId: id,
      });
    }
  });

  /* ── clients and the group ────────────────────────────────────── */

  const customerIds = new Map();
  const groupIds = new Map();

  await transaction(async (tx) => {
    for (const customer of CUSTOMERS) {
      const created = await tx.row(
        `INSERT INTO qodo_projects.customers
           (organization_id, name, kind, email, phone, address, website, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          organizationId,
          customer.name,
          customer.kind,
          customer.email,
          customer.phone,
          customer.address,
          customer.website,
          customer.notes,
          user.id,
        ]
      );
      customerIds.set(customer.ref, created.id);
      await claim(tx, {
        organizationId,
        batchId,
        actorId: user.id,
        entityType: 'customer',
        entityId: created.id,
      });
    }

    for (const group of GROUPS) {
      const created = await tx.row(
        `INSERT INTO qodo_projects.project_groups
           (organization_id, name_ar, name_en, description, color, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [organizationId, group.nameAr, group.nameEn, group.description, group.color, user.id],
      );
      groupIds.set(group.ref, created.id);
      await claim(tx, {
        organizationId,
        batchId,
        actorId: user.id,
        entityType: 'project_group',
        entityId: created.id,
      });
    }
  });

  /* ── rates ────────────────────────────────────────────────────── */

  // Organization-wide and effective from before the earliest demo date, so
  // every logged hour on every demo project finds a rate to freeze against.
  // Without these, labour cost is zero, actual cost is null, and every earned
  // value panel in the demo reports itself unavailable.
  const ratesFrom = dayFromToday(-400);
  await transaction(async (tx) => {
    for (const person of PEOPLE) {
      // The client contact has no cost and no billing rate, and must not be
      // given one: a client is not staff whose hours the company pays for, and
      // inventing a rate would put them in every cost report.
      if (person.costRate === null || person.costRate === undefined) continue;
      await tx.query(
        `INSERT INTO qodo_projects.cost_rates
           (organization_id, user_id, project_id, rate, effective_from, created_by)
         VALUES ($1,$2,NULL,$3,$4,$5)`,
        [organizationId, userIds.get(person.ref), person.costRate, ratesFrom, user.id]
      );
      await tx.query(
        `INSERT INTO qodo_projects.billing_rates
           (organization_id, user_id, project_id, rate, effective_from, created_by)
         VALUES ($1,$2,NULL,$3,$4,$5)`,
        [organizationId, userIds.get(person.ref), person.billRate, ratesFrom, user.id]
      );
    }
  });

  /* ── the working week ─────────────────────────────────────────── */

  /**
   * Sunday–Thursday, with holidays.
   *
   * Every duration, critical path and SLA clock counts this calendar. Creating
   * it is what stops the demo's schedules from being computed against a
   * Monday–Friday week nobody here works.
   */
  const calendarId = await transaction(async (tx) => {
    const calendar = await tx.row(
      `INSERT INTO qodo_projects.work_calendars
         (organization_id, name, workdays, day_start_minutes, day_end_minutes, timezone, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,false) RETURNING id`,
      [
        organizationId,
        WORK_CALENDAR.name,
        WORK_CALENDAR.workdays,
        WORK_CALENDAR.dayStartMinutes,
        WORK_CALENDAR.dayEndMinutes,
        WORK_CALENDAR.timezone,
      ]
    );
    for (const holiday of WORK_CALENDAR.holidays) {
      await tx.query(
        `INSERT INTO qodo_projects.calendar_holidays (calendar_id, holiday_on, name)
         VALUES ($1,$2,$3) ON CONFLICT (calendar_id, holiday_on) DO NOTHING`,
        [calendar.id, dayFromToday(holiday.day), holiday.name]
      );
    }
    await claim(tx, {
      organizationId,
      batchId,
      actorId: user.id,
      entityType: 'work_calendar',
      entityId: calendar.id,
    });
    return calendar.id;
  });

  /* ── tags ─────────────────────────────────────────────────────── */

  const tagIds = new Map();
  await transaction(async (tx) => {
    for (const tag of TAGS) {
      // `ON CONFLICT` on the organization's own unique index: a company that
      // already has a tag called "عاجل" keeps theirs, and the demo attaches to
      // it rather than failing or creating a near-duplicate.
      const created = await tx.row(
        `INSERT INTO qodo_projects.tags (organization_id, name, color, created_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (organization_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, (xmax = 0) AS inserted`,
        [organizationId, tag.name, tag.color, user.id]
      );
      tagIds.set(tag.ref, created.id);
      // Only claim a tag the demo actually created. Claiming one that already
      // existed would delete a real tag on unload.
      if (created.inserted) {
        await claim(tx, {
          organizationId,
          batchId,
          actorId: user.id,
          entityType: 'tag',
          entityId: created.id,
        });
      }
    }
  });

  /* ── projects ─────────────────────────────────────────────────── */

  // `created` is the list of projects; the spread supplies the row counts. The
  // two are kept apart because `blueprintTotals().projects` is a number and
  // would otherwise overwrite the list on the way in.
  const summary = { ...blueprintTotals(), created: [] };

  // The org-level fixtures below reference tasks and issues by their blueprint
  // ref, and those refs are unique across the whole demo rather than per
  // project — so the maps are built here and filled as each project is walked.
  const allTaskIds = new Map();
  const allIssueIds = new Map();

  for (const blueprint of PROJECTS) {
    const project = await projectService.create(user, {
      key: blueprint.key,
      name: blueprint.name,
      description: blueprint.description,
      ownerId: userIds.get(blueprint.ownerRef),
      customerId: customerIds.get(blueprint.customerRef) ?? null,
      groupId: groupIds.get(blueprint.groupRef) ?? null,
      calendarId,
      statusId: statusFor('project', blueprint.statusKey),
      startDate: dayFromToday(blueprint.startDay),
      endDate: dayFromToday(blueprint.endDay),
      access: blueprint.access,
      currency: blueprint.currency,
      billingMethod: blueprint.billingMethod,
      color: blueprint.color,
    });

    // The context every service below writes through. Resolved after creation
    // rather than assembled by hand, so the demo goes through exactly the same
    // authorization path a request would.
    const context = await access.contextFor(user, project.id);

    await claimNow(context, batchId, 'project', project.id);

    /* tags — the cross-project axis, which is the only reason tags exist
       beside phases and lists. The join rows cascade with the project. */
    for (const tagRef of blueprint.tagRefs ?? []) {
      const tagId = tagIds.get(tagRef);
      if (!tagId) continue;
      await query(
        `INSERT INTO qodo_projects.entity_tags
           (tag_id, organization_id, entity_type, entity_id, tagged_by)
         VALUES ($1,$2,'project',$3,$4) ON CONFLICT DO NOTHING`,
        [tagId, organizationId, project.id, user.id]
      );
    }

    /* members */
    for (const member of blueprint.members) {
      const memberId = userIds.get(member.ref);
      // The owner already has a row from `create`; adding it again would only
      // rewrite the role it is already holding.
      if (memberId === project.ownerId) continue;
      await projectService.addMember(context, {
        userId: memberId,
        role: member.role,
        allocationPercent: member.allocation,
      });
    }

    /* budgets and expenses */
    for (const budget of blueprint.budgets) {
      await budgetService.setBudget(context, {
        type: budget.type,
        amount: budget.amount ?? null,
        hours: budget.hours ?? null,
        currency: blueprint.currency,
        thresholdPercent: budget.thresholdPercent,
      });
    }
    for (const expense of blueprint.expenses) {
      await budgetService.addExpense(context, {
        description: expense.description,
        category: expense.category,
        amount: expense.amount,
        incurredOn: dayFromToday(expense.day),
        isBillable: expense.billable,
      });
    }

    /* phases, lists, tasks */
    const taskIds = new Map();
    const phaseIds = new Map();

    for (const phaseSpec of blueprint.phases) {
      const phase = await phaseService.create(context, {
        name: phaseSpec.name,
        description: phaseSpec.description,
        ownerId: userIds.get(phaseSpec.ownerRef) ?? null,
        statusId: statusFor('phase', phaseSpec.statusKey),
        startDate: dayFromToday(phaseSpec.startDay),
        endDate: dayFromToday(phaseSpec.endDay),
        color: phaseSpec.color,
      });
      phaseIds.set(phaseSpec.ref, phase.id);

      for (const listSpec of phaseSpec.lists) {
        const list = await taskListService.create(context, {
          name: listSpec.name,
          description: listSpec.description,
          phaseId: phase.id,
        });

        for (const taskSpec of listSpec.tasks) {
          const task = await taskService.create(context, {
            title: taskSpec.title,
            description: taskSpec.description,
            phaseId: phase.id,
            taskListId: list.id,
            statusId: statusFor('task', taskSpec.statusKey),
            priority: taskSpec.priority,
            startDate: dayFromToday(taskSpec.startDay),
            endDate: dayFromToday(taskSpec.endDay),
            estimatedHours: taskSpec.estimatedHours,
            assigneeIds: taskSpec.assigneeRefs.map((ref) => userIds.get(ref)),
            isBillable: taskSpec.billable,
            billingType: taskSpec.billable ? 'billable' : 'non_billable',
          });
          taskIds.set(taskSpec.ref, task.id);
          allTaskIds.set(taskSpec.ref, task.id);

          // The task *document* lives in the other storage engine and will not
          // cascade when the project row goes. This is the row that lets the
          // unloader take it with them.
          await claimNow(context, batchId, 'task_document', task.id);

          /* Checklist before progress: a required item left open would make
             the status change below fail with `checklist_incomplete`, which is
             the product working correctly and the demo failing to load. */
          for (const item of taskSpec.checklist) {
            const created = await taskService.addChecklistItem(context, task.id, {
              text: item.text,
              isRequired: item.required,
            });
            if (item.done) {
              await taskService.setChecklistItem(context, task.id, created.id, { isDone: true });
            }
          }

          if (taskSpec.progress > 0) {
            await taskService.update(context, task.id, { progress: taskSpec.progress });
          }

          for (const entry of taskSpec.time) {
            await timeService.logTime(context, {
              taskId: task.id,
              userId: userIds.get(entry.ref),
              logDate: dayFromToday(entry.day),
              hours: entry.hours,
              notes: entry.notes,
              isBillable: taskSpec.billable,
            });
          }

          for (const comment of taskSpec.comments) {
            await postComment(context, 'task', task.id, comment, userIds);
          }
        }
      }
    }

    /* dependencies — after every task exists, or half of them dangle */
    for (const dependency of blueprint.dependencies) {
      const predecessorId = taskIds.get(dependency.from);
      const successorId = taskIds.get(dependency.to);
      if (!predecessorId || !successorId) continue;
      await scheduleService.addDependency(context, {
        predecessorId,
        successorId,
        type: dependency.type,
        lagDays: dependency.lagDays,
      });
    }

    /* issues */
    for (const issueSpec of blueprint.issues) {
      const issue = await issueService.create(context, {
        title: issueSpec.title,
        description: issueSpec.description,
        assigneeId: userIds.get(issueSpec.assigneeRef) ?? null,
        statusId: statusFor('issue', issueSpec.statusKey),
        priority: issueSpec.priority,
        severity: issueSpec.severity,
        classification: issueSpec.classification,
        reproducibility: issueSpec.reproducibility,
        moduleAffected: issueSpec.moduleAffected,
        affectedPhaseId: phaseIds.get(issueSpec.affectedPhaseRef) ?? null,
        dueDate: dayFromToday(issueSpec.dueDay),
      });
      allIssueIds.set(issueSpec.ref, issue.id);
      for (const comment of issueSpec.comments) {
        await postComment(context, 'issue', issue.id, comment, userIds);
      }
    }

    /* documents — real bytes, so the file opens rather than erroring */
    const folders = new Map();
    for (const file of blueprint.documents) {
      let folderId = folders.get(file.folder);
      if (!folderId) {
        const folder = await documentService.createFolder(context, { name: file.folder });
        folderId = folder.id;
        folders.set(file.folder, folderId);
      }
      await documentService.upload(context, {
        name: file.name,
        mimeType: 'text/markdown',
        bytes: Buffer.from(file.body, 'utf8'),
        notes: file.description,
        folderId,
      });
    }

    /* timesheets — the weekly wrapper around the hours that were logged */
    await buildTimesheets(user, organizationId, project.id);

    /* baselines — a saved snapshot of the schedule, so the variance view has
       something to compare today's plan against */
    for (const baseline of blueprint.baselines ?? []) {
      await captureBaseline(user, organizationId, project.id, baseline, taskIds);
    }

    summary.created.push({ id: project.id, key: project.key, name: project.name });
  }

  /* ── organization-level configuration ─────────────────────────── */

  await seedOrgFixtures(user, organizationId, batchId, {
    projectIds: new Map(summary.created.map((project, index) => [PROJECTS[index].ref, project.id])),
    taskIds: allTaskIds,
    issueIds: allIssueIds,
    userIds,
    calendarId,
  });

  await audit.record({
    actor: user,
    organizationId,
    entityType: 'demo_data',
    entityId: batchId,
    action: 'demo.load',
    after: { batchId, projects: summary.created.length },
  });

  return { batchId, ...summary };
}

/* ------------------------------------------------------------------ */
/* Organization-level configuration                                     */
/* ------------------------------------------------------------------ */

/**
 * Fill the Settings tabs, the saved reports and the notification list.
 *
 * These are what turn "the feature exists" into "the feature is configured",
 * and they are the difference between a Settings page that reads as unfinished
 * and one that reads as a product somebody set up.
 *
 * Two constraints run through every insert below, and both are about not
 * lying:
 *
 *   • **Integrations are never `connected`.** They are created
 *     `not_configured` with no credential column written at all. The adapters
 *     already answer 409 without a credential, so the product's own honesty
 *     rule enforces this rather than a convention here.
 *
 *   • **Webhooks are created inactive and point at `.invalid`.** Two
 *     independent reasons no HTTP request can leave: the delivery worker skips
 *     inactive endpoints, and the host cannot resolve. One would do; two means
 *     a future change to either alone cannot start sending traffic.
 */
async function seedOrgFixtures(user, organizationId, batchId, refs) {
  const { projectIds, taskIds, issueIds, userIds } = refs;
  const ruleIds = new Map();

  await transaction(async (tx) => {
    /* ── workflow rules ─────────────────────────────────────────── */
    for (const [index, rule] of WORKFLOW_RULES.entries()) {
      const created = await tx.row(
        `INSERT INTO qodo_projects.workflow_rules
           (organization_id, module_key, name, description, trigger, trigger_field,
            criteria, match, actions, schedule, last_run_at, is_active, order_index, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        [
          organizationId,
          rule.moduleKey,
          rule.name,
          rule.description,
          rule.trigger,
          rule.triggerField ?? null,
          JSON.stringify(rule.criteria),
          rule.match,
          JSON.stringify(rule.actions),
          rule.schedule ? JSON.stringify(rule.schedule) : null,
          rule.lastRunDay === undefined ? null : `${dayFromToday(rule.lastRunDay)}T08:00:00Z`,
          rule.isActive,
          index,
          user.id,
        ]
      );
      ruleIds.set(rule.ref, created.id);
      await claim(tx, { organizationId, batchId, actorId: user.id, entityType: 'workflow_rule', entityId: created.id });
    }

    /* ── business rules ─────────────────────────────────────────── */
    for (const rule of BUSINESS_RULES) {
      const created = await tx.row(
        `INSERT INTO qodo_projects.business_rules
           (organization_id, module_key, name, criteria, match, actions, stop_processing, is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          organizationId,
          rule.moduleKey,
          rule.name,
          JSON.stringify(rule.criteria),
          rule.match,
          JSON.stringify(rule.actions),
          rule.stopProcessing,
          rule.isActive,
          user.id,
        ]
      );
      ruleIds.set(rule.ref, created.id);
      await claim(tx, { organizationId, batchId, actorId: user.id, entityType: 'business_rule', entityId: created.id });
    }

    /* ── run history ────────────────────────────────────────────── */
    for (const [index, run] of AUTOMATION_RUNS.entries()) {
      const entityId =
        run.entityType === 'issue' ? issueIds.get(run.entityRef) : taskIds.get(run.entityRef);
      // A run pointing at an entity the blueprint no longer contains is a
      // dangling row on a screen, so it is dropped rather than written.
      if (!entityId) continue;

      await tx.query(
        `INSERT INTO qodo_projects.automation_runs
           (organization_id, rule_type, rule_id, entity_type, entity_id, trigger,
            status, actions_applied, error, idempotency_key, ran_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          organizationId,
          run.ruleType,
          ruleIds.get(run.ruleRef) ?? null,
          run.entityType,
          entityId,
          run.trigger,
          run.status,
          JSON.stringify(run.actionsApplied ?? []),
          run.error ?? null,
          `demo:${batchId}:${index}`,
          `${dayFromToday(run.day)}T08:05:00Z`,
        ]
      );
    }

    /* ── webhooks ───────────────────────────────────────────────── */
    for (const endpoint of WEBHOOK_ENDPOINTS) {
      const created = await tx.row(
        `INSERT INTO qodo_projects.webhook_endpoints
           (organization_id, name, url, method, events, secret, is_active,
            disabled_at, disabled_reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,false,now(),$7,$8) RETURNING id`,
        [
          organizationId,
          endpoint.name,
          endpoint.url,
          endpoint.method,
          JSON.stringify(endpoint.events),
          endpoint.secret,
          endpoint.disabledReason,
          user.id,
        ]
      );
      await claim(tx, { organizationId, batchId, actorId: user.id, entityType: 'webhook_endpoint', entityId: created.id });

      for (const delivery of endpoint.deliveries) {
        await tx.query(
          `INSERT INTO qodo_projects.webhook_deliveries
             (endpoint_id, organization_id, event, payload, attempt, response_status,
              response_body, error, duration_ms, delivered_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
          [
            created.id,
            organizationId,
            delivery.event,
            JSON.stringify(delivery.payload),
            delivery.attempt,
            delivery.responseStatus ?? null,
            delivery.responseBody ?? null,
            delivery.error ?? null,
            delivery.durationMs ?? null,
            `${dayFromToday(delivery.day)}T10:00:00Z`,
          ]
        );
      }
    }

    /* ── integrations ───────────────────────────────────────────── */
    for (const integration of INTEGRATIONS) {
      // `credentials` is left NULL, deliberately and not by omission: the
      // status below is only honest because there is nothing behind it.
      const created = await tx.row(
        `INSERT INTO qodo_projects.integration_connections
           (organization_id, provider, name, credentials, status, created_by)
         VALUES ($1,$2,$3,NULL,'not_configured',$4)
         ON CONFLICT (organization_id, provider, name) DO NOTHING
         RETURNING id`,
        [organizationId, integration.provider, integration.name, user.id]
      );
      if (created) {
        await claim(tx, { organizationId, batchId, actorId: user.id, entityType: 'integration', entityId: created.id });
      }
    }

    /* ── SLA ────────────────────────────────────────────────────── */
    for (const policy of SLA_POLICIES) {
      const created = await tx.row(
        `INSERT INTO qodo_projects.sla_policies
           (organization_id, name, description, criteria, match, response_minutes,
            resolution_minutes, calendar_id, escalations, is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [
          organizationId,
          policy.name,
          policy.description,
          JSON.stringify(policy.criteria),
          policy.match,
          // The table refuses a policy with neither figure — a service level
          // that promises nothing is not a service level.
          policy.responseMinutes,
          policy.resolutionMinutes,
          // Attached to the demo's own Sunday–Thursday calendar, so "4 working
          // hours" counts this company's week rather than wall-clock time and
          // the clock does not run over the weekend.
          refs.calendarId ?? null,
          JSON.stringify(policy.escalations),
          policy.isActive,
          user.id,
        ]
      );
      await claim(tx, { organizationId, batchId, actorId: user.id, entityType: 'sla_policy', entityId: created.id });
    }

    /* ── saved reports ──────────────────────────────────────────── */
    for (const report of SAVED_REPORTS) {
      const created = await tx.row(
        `INSERT INTO qodo_projects.saved_reports
           (organization_id, name, description, module_key, definition, visibility, owner_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          organizationId,
          report.name,
          report.description,
          report.moduleKey,
          JSON.stringify(report.definition),
          report.visibility,
          user.id,
        ]
      );
      await claim(tx, { organizationId, batchId, actorId: user.id, entityType: 'saved_report', entityId: created.id });
    }

    /* ── saved views ────────────────────────────────────────────── */
    for (const view of SAVED_VIEWS) {
      const module = await tx.row(
        'SELECT id FROM qodo_projects.modules WHERE organization_id = $1 AND key = $2',
        [organizationId, view.moduleKey]
      );
      if (!module) continue;

      const created = await tx.row(
        `INSERT INTO qodo_projects.custom_views
           (organization_id, module_id, name, criteria, sort, group_by, columns, visibility, owner_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          organizationId,
          module.id,
          view.name,
          JSON.stringify(view.criteria),
          JSON.stringify(view.sort),
          view.groupBy,
          JSON.stringify(view.columns),
          view.visibility,
          user.id,
        ]
      );
      await claim(tx, { organizationId, batchId, actorId: user.id, entityType: 'custom_view', entityId: created.id });
    }

    /* ── favourites and recents ─────────────────────────────────── */
    /* Pinned for the administrator who loaded the demo, because they are the
       person about to look at it — a favourites tab that is empty on the first
       visit does not explain what favourites are for. */
    for (const [ref, projectId] of projectIds) {
      if (!projectId) continue;
      if (ref === 'shop' || ref === 'app') {
        await tx.query(
          `INSERT INTO qodo_projects.project_favorites (organization_id, project_id, user_id)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [organizationId, projectId, user.id]
        );
      }
      await tx.query(
        `INSERT INTO qodo_projects.project_recent_views (organization_id, project_id, user_id, viewed_at)
         VALUES ($1,$2,$3,now()) ON CONFLICT (project_id, user_id) DO UPDATE SET viewed_at = now()`,
        [organizationId, projectId, user.id]
      );
    }
  });

  /* ── notifications ──────────────────────────────────────────── */

  /**
   * Notifications live in the workspace store, not in the Projects schema, so
   * they are written after the transaction rather than inside it — a
   * PostgreSQL transaction cannot roll back a JSON document write, and
   * pretending otherwise would be worse than doing it plainly outside.
   */
  for (const notice of NOTIFICATIONS) {
    const entityId =
      notice.entityType === 'issue'
        ? issueIds.get(notice.entityRef)
        : notice.entityType === 'task'
          ? taskIds.get(notice.entityRef)
          : projectIds.get(notice.entityRef ?? '') ?? null;

    const created = await createDocument('notifications', {
      organizationId,
      userId: user.id,
      kind: notice.kind,
      title: notice.titleAr,
      body: notice.bodyAr,
      entityType: notice.entityType,
      entityId: entityId ?? null,
      projectId: projectIds.get(notice.projectRef) ?? null,
      link: projectIds.get(notice.projectRef) ? `/projects/${projectIds.get(notice.projectRef)}` : null,
      readAt: notice.read ? new Date().toISOString() : null,
      createdAt: `${dayFromToday(notice.day)}T09:00:00Z`,
      isDemo: true,
    });

    await query(
      `INSERT INTO qodo_projects.demo_seeds
         (organization_id, batch_id, entity_type, entity_id, created_by)
       VALUES ($1,$2,'notification',$3,$4)
       ON CONFLICT (batch_id, entity_type, entity_id) DO NOTHING`,
      [organizationId, batchId, created.id, user.id]
    );
  }

  void userIds;
}

/* ------------------------------------------------------------------ */
/* Timesheets                                                           */
/* ------------------------------------------------------------------ */

/**
 * Wrap the logged hours into weekly timesheets, in all four states.
 *
 * A demo where every hour is already approved shows a working product with its
 * most interesting screen switched off: the approval queue is empty, the
 * "submitted" filter returns nothing, and nobody can tell that a rejection
 * carries a reason. So the weeks are aged into the four states the product
 * actually has, by how long ago they were:
 *
 *   older than 21 days → approved   (the settled past)
 *   8–21 days ago      → one rejected, the rest approved
 *   the last full week → submitted   (waiting on somebody, which is the point)
 *   this week          → draft       (still being filled in)
 *
 * Rates are frozen only on the approved weeks, because that is what the real
 * product does — `reviewTimesheet` stamps them on approval and nowhere else.
 * The consequence is visible and correct: the newest hours have not been costed
 * yet, exactly as they would not be in a live system mid-month.
 */
async function buildTimesheets(user, organizationId, projectId) {
  const entries = await rows(
    `SELECT DISTINCT user_id, log_date
       FROM qodo_projects.time_entries
      WHERE project_id = $1 AND organization_id = $2`,
    [projectId, organizationId]
  );
  if (entries.length === 0) return;

  // One sheet per person per week. The set is built in JavaScript rather than
  // grouped in SQL because `weekStart` is the product's own Sunday-based
  // definition, and re-deriving it in SQL is how the two drift apart.
  const weeks = new Map();
  for (const entry of entries) {
    const start = timeService.weekStart(entry.log_date);
    weeks.set(`${entry.user_id}:${start}`, { userId: entry.user_id, start });
  }

  const today = dayFromToday(0);
  const thisWeek = timeService.weekStart(today);
  const lastWeek = timeService.weekStart(dayFromToday(-7));

  // One rejected week in the whole demo, picked deterministically so a reload
  // produces the same story rather than a different one each time.
  const sorted = [...weeks.values()].sort((a, b) => (a.start < b.start ? -1 : 1));
  const rejectable = sorted.filter((week) => week.start < lastWeek && week.start >= timeService.weekStart(dayFromToday(-21)));
  const rejected = rejectable[0] ?? null;

  for (const week of sorted) {
    let status = 'approved';
    if (week.start === thisWeek) status = 'draft';
    else if (week.start === lastWeek) status = 'submitted';
    else if (rejected && week.userId === rejected.userId && week.start === rejected.start) status = 'rejected';

    const end = timeService.weekEnd(week.start);

    await transaction(async (tx) => {
      const sheet = await tx.row(
        `INSERT INTO qodo_projects.timesheets
           (organization_id, user_id, period_start, period_end, status,
            submitted_at, reviewed_at, reviewed_by, rejection_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (organization_id, user_id, period_start) DO UPDATE
           SET status = EXCLUDED.status
         RETURNING id`,
        [
          organizationId,
          week.userId,
          week.start,
          end,
          status,
          status === 'draft' ? null : `${end}T16:00:00Z`,
          status === 'approved' || status === 'rejected' ? `${end}T18:00:00Z` : null,
          status === 'approved' || status === 'rejected' ? user.id : null,
          status === 'rejected'
            ? 'ساعات يوم الثلاثاء مسجّلة على المشروع الغلط. من فضلك انقلها وأعد الإرسال.'
            : '',
        ]
      );

      // Attach that person's entries for that week to the sheet. Scoped by
      // project as well, so a person's hours on another project are not swept
      // into a timesheet this demo created.
      await tx.query(
        `UPDATE qodo_projects.time_entries
            SET timesheet_id = $1, approval_status = $2
          WHERE project_id = $3 AND user_id = $4
            AND log_date BETWEEN $5 AND $6
            AND timesheet_id IS NULL`,
        [sheet.id, status === 'submitted' ? 'submitted' : status, projectId, week.userId, week.start, end]
      );

      if (status === 'approved') {
        await timeService.freezeRates(tx, { timesheetId: sheet.id });
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* Baselines                                                            */
/* ------------------------------------------------------------------ */

/**
 * Save a snapshot of the schedule as it stands, then age it.
 *
 * The snapshot is taken from the tasks' *current* dates, which is what
 * `scheduleService.captureBaseline` does for real. The dates are then shifted
 * back by the drift the blueprint describes, so the comparison view has
 * something to show — a baseline identical to the live plan reports zero
 * variance on every row and teaches the reader that the feature is broken.
 *
 * The shift is applied to the baseline's *copy*, never to the live tasks.
 */
async function captureBaseline(user, organizationId, projectId, spec, taskIds) {
  await transaction(async (tx) => {
    const baseline = await tx.row(
      `INSERT INTO qodo_projects.project_baselines
         (organization_id, project_id, name, notes, captured_at, captured_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [organizationId, projectId, spec.name, spec.notes, `${dayFromToday(spec.capturedDay)}T09:00:00Z`, user.id]
    );

    /**
     * The plan as it was.
     *
     * A task that started *after* the baseline was captured was not in that
     * plan at all, so it is excluded rather than copied — a baseline containing
     * work nobody had thought of yet is not a baseline.
     *
     * The three-day pull-in on tasks that have since moved is what produces a
     * readable variance: the original plan was tighter than what happened,
     * which is the normal direction for a project to drift.
     */
    await tx.query(
      `INSERT INTO qodo_projects.task_baselines
         (baseline_id, task_id, organization_id, start_date, end_date, duration_days, estimated_hours)
       SELECT $1,
              t.task_id,
              $2,
              t.start_date,
              CASE WHEN t.end_date > CURRENT_DATE THEN t.end_date - 3 ELSE t.end_date END,
              t.duration_days,
              t.estimated_hours
         FROM qodo_projects.project_task_extensions t
        WHERE t.project_id = $3 AND t.deleted_at IS NULL
          AND (t.start_date IS NULL OR t.start_date <= $4::date)
        ON CONFLICT (baseline_id, task_id) DO NOTHING`,
      [baseline.id, organizationId, projectId, dayFromToday(spec.capturedDay)]
    );
  });
  void taskIds;
}

/**
 * Post one comment as the person who is supposed to have written it.
 *
 * `addComment` takes the author from `context.user`, which is correct for every
 * real caller and wrong for a seeder: every demo comment would carry the
 * administrator's name and the conversation would read as one person talking to
 * themselves. So the comment is written normally — mentions parsed, audit row
 * recorded, visibility decided by the same rules — and the author is corrected
 * immediately afterwards. The alternative, a second INSERT path that bypasses
 * `addComment`, would be a copy of the mention parser that drifts.
 */
async function postComment(context, entityType, entityId, comment, userIds) {
  const created = await collaboration.addComment(context, entityType, entityId, {
    body: comment.body,
    isInternal: true,
  });

  await query(
    `UPDATE qodo_projects.comments
        SET author_id = $2, created_at = $3::date, updated_at = $3::date
      WHERE id = $1`,
    [created.id, userIds.get(comment.ref), dayFromToday(comment.day)]
  );

  return created;
}

/* ------------------------------------------------------------------ */
/* Unloading                                                            */
/* ------------------------------------------------------------------ */

/**
 * Remove everything the loader created, and nothing else.
 *
 * Order matters, and it is the reverse of creation for one reason: the blobs
 * behind demo documents are keyed by rows that cascade away with the project,
 * so they have to be collected *before* the projects go or the bytes are
 * unreachable and stay in the store forever.
 *
 * The user rows carry a second gate. A manifest row could in principle name an
 * account that is not a demo account — a corrupted row, a restored backup, a
 * mistake in a future edit of this file — and deleting a real person's login is
 * not a recoverable error. So each one is re-read and only deleted if it still
 * says `isDemo`. Anything that fails that check is left alone and reported.
 */
export async function unload(user, batchId = null) {
  const organizationId = organizationOf(user);

  const seeds = await rows(
    `SELECT batch_id, entity_type, entity_id
       FROM qodo_projects.demo_seeds
      WHERE organization_id = $1 AND ($2::uuid IS NULL OR batch_id = $2)`,
    [organizationId, batchId]
  );

  if (seeds.length === 0) {
    return { removed: { projects: 0, customers: 0, groups: 0, people: 0, tasks: 0 }, skipped: [] };
  }

  const idsOf = (type) => seeds.filter((seed) => seed.entity_type === type).map((seed) => seed.entity_id);

  const projectIds = idsOf('project');
  const customerIds = idsOf('customer');
  const groupIds = idsOf('project_group');
  const peopleIds = idsOf('user');
  const taskDocumentIds = idsOf('task_document');
  const notificationIds = idsOf('notification');

  /**
   * The organization-level rows, and the table each one lives in.
   *
   * A table-driven list rather than ten near-identical DELETE statements: every
   * one of these is "delete these ids from this table, scoped to this
   * organization", and writing it ten times is ten chances to forget the
   * tenant filter on one of them.
   *
   * The table names come from this map, never from the manifest — `entity_type`
   * is data, and data that reaches an SQL identifier is an injection. An
   * unknown type is skipped rather than interpolated.
   */
  const ORG_TABLES = {
    work_calendar: 'work_calendars',
    tag: 'tags',
    workflow_rule: 'workflow_rules',
    business_rule: 'business_rules',
    webhook_endpoint: 'webhook_endpoints',
    integration: 'integration_connections',
    sla_policy: 'sla_policies',
    saved_report: 'saved_reports',
    custom_view: 'custom_views',
  };

  const store = await getStore();
  const skipped = [];

  /* 1. Blob bytes, while the rows that point at them still exist. */
  if (projectIds.length > 0) {
    const blobs = await rows(
      `SELECT v.blob_id
         FROM qodo_projects.document_versions v
         JOIN qodo_projects.document_files f ON f.id = v.file_id
        WHERE f.project_id = ANY($1::uuid[]) AND f.organization_id = $2`,
      [projectIds, organizationId]
    );
    for (const blob of blobs) {
      await removeBlob(blob.blob_id).catch(() => {});
    }
  }

  /* 2. Task documents in the workspace store. They do not cascade. */
  let removedTasks = 0;
  for (const taskId of taskDocumentIds) {
    if (await store.remove('tasks', taskId)) removedTasks += 1;
  }

  /* 3. The projects, which cascade to phases, lists, task extensions,
        dependencies, issues, time entries, comments, documents and budgets. */
  let removedProjects = 0;
  if (projectIds.length > 0) {
    const { rowCount } = await query(
      'DELETE FROM qodo_projects.projects WHERE id = ANY($1::uuid[]) AND organization_id = $2',
      [projectIds, organizationId]
    );
    removedProjects = rowCount;
  }

  /* 4. Rates, which hang off the demo people rather than the projects. */
  if (peopleIds.length > 0) {
    await query(
      'DELETE FROM qodo_projects.cost_rates WHERE organization_id = $1 AND user_id = ANY($2::text[])',
      [organizationId, peopleIds]
    );
    await query(
      'DELETE FROM qodo_projects.billing_rates WHERE organization_id = $1 AND user_id = ANY($2::text[])',
      [organizationId, peopleIds]
    );
  }

  /* 5. Clients and the group, now that no project references them. */
  let removedCustomers = 0;
  if (customerIds.length > 0) {
    const { rowCount } = await query(
      'DELETE FROM qodo_projects.customers WHERE id = ANY($1::uuid[]) AND organization_id = $2',
      [customerIds, organizationId]
    );
    removedCustomers = rowCount;
  }

  let removedGroups = 0;
  if (groupIds.length > 0) {
    const { rowCount } = await query(
      'DELETE FROM qodo_projects.project_groups WHERE id = ANY($1::uuid[]) AND organization_id = $2',
      [groupIds, organizationId]
    );
    removedGroups = rowCount;
  }

  /* 6. The people — each re-checked before deletion. */
  let removedPeople = 0;
  for (const personId of peopleIds) {
    const person = await store.get('users', personId);
    if (!person) continue;
    if (person.isDemo !== true) {
      // Refusing is the whole point of the check. Say which account, so
      // whoever reads the response can go and look at it.
      skipped.push({ entityType: 'user', entityId: personId, reason: 'not_marked_demo' });
      continue;
    }
    if (await store.remove('users', personId)) removedPeople += 1;
  }

  /* 6b. Notifications, which live in the workspace store beside the tasks. */
  let removedNotifications = 0;
  for (const noticeId of notificationIds) {
    if (await store.remove('notifications', noticeId)) removedNotifications += 1;
  }

  /* 6c. The organization-level configuration rows.

     These go *after* the projects, because a saved view or a workflow rule may
     reference a project — the foreign keys are ON DELETE CASCADE or SET NULL,
     so either order works, but removing the children first keeps the audit
     trail's ordering readable. */
  let removedConfig = 0;
  for (const [entityType, table] of Object.entries(ORG_TABLES)) {
    const ids = idsOf(entityType);
    if (ids.length === 0) continue;
    // `work_calendars` is the one table here with no organization_id-scoped
    // delete path worth special-casing — it has the column like every other.
    const { rowCount } = await query(
      `DELETE FROM qodo_projects.${table} WHERE id = ANY($1::uuid[]) AND organization_id = $2`,
      [ids, organizationId]
    );
    removedConfig += rowCount;
  }

  /* 7. The manifest itself, last — until this row is gone, a failed unload can
        be retried and will pick up exactly where it stopped. */
  await query(
    'DELETE FROM qodo_projects.demo_seeds WHERE organization_id = $1 AND ($2::uuid IS NULL OR batch_id = $2)',
    [organizationId, batchId]
  );

  await audit.record({
    actor: user,
    organizationId,
    entityType: 'demo_data',
    entityId: batchId ?? 'all',
    action: 'demo.unload',
    before: { projects: projectIds.length, people: peopleIds.length },
    after: { projects: removedProjects, people: removedPeople, skipped: skipped.length },
  });

  return {
    removed: {
      projects: removedProjects,
      customers: removedCustomers,
      groups: removedGroups,
      people: removedPeople,
      tasks: removedTasks,
      notifications: removedNotifications,
      configuration: removedConfig,
    },
    skipped,
  };
}

/* ------------------------------------------------------------------ */
/* Reset                                                                */
/* ------------------------------------------------------------------ */

/**
 * Remove the demo and build it again.
 *
 * Not sugar for two clicks. The demo's dates are offsets from *today*, so a set
 * loaded three months ago has drifted into a museum — every "upcoming"
 * milestone is in the past and the project that had not started has finished.
 * Reset is how somebody puts it back on today's calendar, and it is also the
 * repair for a demo that has been half-edited during a walkthrough.
 *
 * Sequential and deliberately not wrapped in one transaction: `unload` deletes
 * from the workspace document store as well as from PostgreSQL, and a
 * PostgreSQL transaction cannot roll back a JSON file write. A reset that
 * failed halfway would leave the manifest describing what still exists, and
 * running it again would finish the job — which is a better property than a
 * rollback that could not have been honest anyway.
 */
export async function reset(user) {
  if (!isEnabled()) throw conflict('demo_data_disabled');

  const removed = await unload(user);
  const loaded = await load(user);

  await audit.record({
    actor: user,
    organizationId: organizationOf(user),
    entityType: 'demo_data',
    entityId: loaded.batchId,
    action: 'demo.reset',
    before: { removed: removed.removed },
    after: { batchId: loaded.batchId, projects: loaded.created.length },
  });

  return { removed: removed.removed, ...loaded };
}
