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

import { CUSTOMERS, GROUPS, PEOPLE, PROJECTS, blueprintTotals } from './demoBlueprint.js';

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

  const existing = await row(
    'SELECT batch_id FROM qodo_projects.demo_seeds WHERE organization_id = $1 LIMIT 1',
    [organizationId]
  );
  if (existing) {
    throw conflict('demo_data_already_loaded', {
      hint: 'Remove the existing demo data before loading it again.',
    });
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

  /* ── projects ─────────────────────────────────────────────────── */

  // `created` is the list of projects; the spread supplies the row counts. The
  // two are kept apart because `blueprintTotals().projects` is a number and
  // would otherwise overwrite the list on the way in.
  const summary = { ...blueprintTotals(), created: [] };

  for (const blueprint of PROJECTS) {
    const project = await projectService.create(user, {
      key: blueprint.key,
      name: blueprint.name,
      description: blueprint.description,
      ownerId: userIds.get(blueprint.ownerRef),
      customerId: customerIds.get(blueprint.customerRef) ?? null,
      groupId: groupIds.get(blueprint.groupRef) ?? null,
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

    /* Freeze the rates onto the entries that were logged, the same way an
       approved timesheet does. Without this every hour costs nothing and the
       budget and earned-value screens have no actual cost to report. */
    await transaction(async (tx) => {
      await tx.query(
        `UPDATE qodo_projects.time_entries
            SET approval_status = 'approved'
          WHERE project_id = $1 AND log_date < CURRENT_DATE`,
        [project.id]
      );
      await timeService.freezeRates(tx, { projectId: project.id });
    });

    summary.created.push({ id: project.id, key: project.key, name: project.name });
  }

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
    },
    skipped,
  };
}
