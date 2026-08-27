import { Router } from 'express';
import { logActivity, requireAuth, requirePermission } from '../auth.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { organizationOf } from '../../shared/organization.js';
import { KPI_TEMPLATES } from '../../shared/kpi.js';
import {
  KPIError,
  createScorecard,
  deleteScorecard,
  kpiOverviewFor,
  kpiScorecardFor,
  setScorecardStatus,
  updateScorecard,
} from '../kpi.js';

const router = Router();

function fail(res, error) {
  if (error instanceof KPIError) {
    return res.status(error.status).json({ error: error.code, details: error.details ?? undefined });
  }
  console.error('[kpi]', error);
  return res.status(500).json({ error: 'server_error' });
}

router.use(requireAuth);

/** The catalogue is the same for every tenant, so anyone signed in may read it. */
router.get('/catalogue', (_req, res) => {
  res.json({ templates: KPI_TEMPLATES });
});

router.get('/overview', async (req, res) => {
  try {
    res.json(await kpiOverviewFor(req.user));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/scorecards/:id', async (req, res) => {
  try {
    res.json({ scorecard: await kpiScorecardFor(req.user, req.params.id) });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/scorecards', requirePermission(PERMISSIONS.HR_MANAGE), async (req, res) => {
  try {
    const scorecard = await createScorecard({
      organizationId: organizationOf(req.user),
      templateId: req.body?.templateId,
      period: req.body?.period,
      subjectType: req.body?.subjectType,
      subjectId: req.body?.subjectId,
      subjectName: req.body?.subjectName,
      actorId: req.user.id,
    });
    await logActivity({
      actorId: req.user.id,
      action: 'kpi.scorecard.create',
      subject: 'kpiScorecard',
      subjectId: scorecard.id,
      meta: { templateId: scorecard.templateId, period: scorecard.period, subject: scorecard.subjectName },
    });
    res.status(201).json({ scorecard });
  } catch (error) {
    fail(res, error);
  }
});

router.patch('/scorecards/:id', requirePermission(PERMISSIONS.HR_MANAGE), async (req, res) => {
  try {
    const scorecard = await updateScorecard({
      organizationId: organizationOf(req.user),
      id: req.params.id,
      patch: req.body,
      actorId: req.user.id,
    });
    res.json({ scorecard });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/scorecards/:id/status', requirePermission(PERMISSIONS.HR_MANAGE), async (req, res) => {
  try {
    const scorecard = await setScorecardStatus({
      organizationId: organizationOf(req.user),
      id: req.params.id,
      status: String(req.body?.status || ''),
      actorId: req.user.id,
    });
    await logActivity({
      actorId: req.user.id,
      action: `kpi.scorecard.${scorecard.status === 'final' ? 'finalize' : 'reopen'}`,
      subject: 'kpiScorecard',
      subjectId: scorecard.id,
      meta: { period: scorecard.period, percent: scorecard.result.approved.percent },
    });
    res.json({ scorecard });
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/scorecards/:id', requirePermission(PERMISSIONS.HR_MANAGE), async (req, res) => {
  try {
    const removed = await deleteScorecard({
      organizationId: organizationOf(req.user),
      id: req.params.id,
    });
    await logActivity({
      actorId: req.user.id,
      action: 'kpi.scorecard.delete',
      subject: 'kpiScorecard',
      subjectId: removed.id,
      meta: {},
    });
    res.status(204).end();
  } catch (error) {
    fail(res, error);
  }
});

export default router;
