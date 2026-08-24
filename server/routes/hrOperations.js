import { Router } from 'express';
import { create, findOne, getStore } from '../store.js';
import { logActivity, requireAuth, requirePermission } from '../auth.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { HR_PERIODIC_TASKS, hrTaskById } from '../../shared/hrPeriodicTasks.js';
import { hrAutomationSummary, hrScheduleForTemplate } from '../../shared/hrRecurrence.js';
import { organizationOf } from '../../shared/organization.js';
import { canAssignUser, canUseDepartment } from '../taskAccess.js';
import {
  generateHROperations,
  hrPlanId,
  hrPlansForOrganization,
  localDayInTimezone,
} from '../hrOperations.js';

const router = Router();
const MAX_ASSIGNEES = 8;

router.use(requireAuth);

function requireHRAccess(req, res, next) {
  if (!canUseDepartment(req.user, 'hr')) return res.status(403).json({ error: 'forbidden_team' });
  next();
}

router.get(
  '/plans',
  requirePermission(PERMISSIONS.TASKS_VIEW),
  requireHRAccess,
  async (req, res) => {
    const organizationId = organizationOf(req.user);
    const plans = await hrPlansForOrganization(organizationId);
    const summary = hrAutomationSummary(HR_PERIODIC_TASKS);
    res.json({
      plans,
      summary: {
        ...summary,
        enabled: plans.filter((plan) => plan.enabled).length,
        configured: plans.filter((plan) => plan.assigneeIds.length > 0).length,
      },
    });
  }
);

router.put(
  '/plans',
  requirePermission(PERMISSIONS.TASKS_CREATE),
  requirePermission(PERMISSIONS.TASKS_ASSIGN),
  requireHRAccess,
  async (req, res) => {
    const entries = req.body?.plans;
    if (!Array.isArray(entries) || entries.length > HR_PERIODIC_TASKS.length) {
      return res.status(400).json({ error: 'invalid_hr_plans' });
    }

    const organizationId = organizationOf(req.user);
    const checked = [];
    for (const entry of entries) {
      const template = hrTaskById(String(entry?.templateId || ''));
      if (!template) return res.status(400).json({ error: 'unknown_hr_template' });
      const enabled = entry.enabled === true;
      const assigneeIds = [...new Set(
        (Array.isArray(entry.assigneeIds) ? entry.assigneeIds : []).map(String).filter(Boolean)
      )];
      if (assigneeIds.length > MAX_ASSIGNEES) {
        return res.status(400).json({ error: 'too_many_assignees' });
      }
      if (enabled && hrScheduleForTemplate(template).mode !== 'scheduled') {
        return res.status(409).json({ error: 'hr_event_triggered' });
      }
      if (enabled && assigneeIds.length === 0) {
        return res.status(400).json({ error: 'hr_owner_required' });
      }
      for (const userId of assigneeIds) {
        const person = await findOne('users', (user) => user.id === userId);
        if (!canAssignUser(req.user, person, 'hr')) {
          return res.status(400).json({ error: 'assignee_team_mismatch' });
        }
      }
      checked.push({ template, enabled, assigneeIds });
    }

    const store = await getStore();
    const today = localDayInTimezone();
    for (const entry of checked) {
      const id = hrPlanId(organizationId, entry.template.id);
      const current = await findOne('hrTaskPlans', (plan) => plan.id === id);
      const enabledOn = entry.enabled
        ? current?.enabled === true
          ? current.enabledOn ?? today
          : today
        : null;
      const patch = {
        organizationId,
        templateId: entry.template.id,
        enabled: entry.enabled,
        enabledOn,
        assigneeIds: entry.assigneeIds,
        configuredBy: req.user.id,
      };
      if (current) await store.update('hrTaskPlans', id, patch);
      else await create('hrTaskPlans', { id, ...patch });
    }

    await logActivity({
      actorId: req.user.id,
      action: 'hr.recurring.configure',
      subject: 'hrTaskPlan',
      subjectId: 'catalogue',
      meta: {
        changed: checked.length,
        enabled: checked.filter((entry) => entry.enabled).length,
      },
    });

    res.json({ plans: await hrPlansForOrganization(organizationId) });
  }
);

router.post(
  '/generate',
  requirePermission(PERMISSIONS.TASKS_CREATE),
  requirePermission(PERMISSIONS.TASKS_ASSIGN),
  requireHRAccess,
  async (req, res) => {
    const templateId = req.body?.templateId ? String(req.body.templateId) : null;
    if (templateId && !hrTaskById(templateId)) {
      return res.status(400).json({ error: 'unknown_hr_template' });
    }
    const onDate = localDayInTimezone();
    const result = await generateHROperations({
      organizationId: organizationOf(req.user),
      onDate,
      templateId,
      requestedBy: req.user.id,
    });
    res.json({
      onDate,
      created: result.created,
      existing: result.existing.map((task) => task.id),
      skipped: result.skipped,
    });
  }
);

export default router;
