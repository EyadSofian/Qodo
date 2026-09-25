/**
 * /api/hr/recruitment — the recruitment desk's API.
 *
 * Every handler delegates to a service that re-checks the caller's authority
 * for the specific request it touches. Nothing here trusts the UI: a button
 * the screen hid is still refused if somebody calls the endpoint directly.
 */

import { Router } from 'express';
import { handle } from './hrFail.js';
import {
  approve,
  assign,
  capacityPreview,
  changePriority,
  createRequest,
  extend,
  linkOdooJob,
  listRequests,
  recordAccepted,
  requestDetail,
  review,
  transition,
  updateRequest,
} from '../hr/recruitment/requests.js';
import { capacityBoard, recruitmentAlerts, recruitmentOverview, recruitmentSummary, recruitmentTeam } from '../hr/recruitment/desk.js';
import { pipelineSummaries, recruitmentOdooOverview, requestPipeline } from '../hr/recruitment/odooPipeline.js';
import { createKpiEvent, kpiDetail, kpiOverview, voidKpiEvent } from '../hr/recruitment/kpi.js';
import { decideRewardBatch, rewardsOverview } from '../hr/recruitment/rewards.js';

const router = Router();
const h = (fn) => handle(fn, 'hr.recruitment');
const body = (req) => req.body ?? {};

router.get('/overview', h((req) => recruitmentOverview(req.user)));
router.get('/team', h((req) => recruitmentTeam(req.user)));
router.get('/summary', h((req) => recruitmentSummary(req.user)));
router.get('/alerts', h((req) => recruitmentAlerts(req.user)));
router.get('/capacity', h((req) => capacityBoard(req.user)));
router.get('/capacity/check', h((req) => capacityPreview(req.user, {
  recruiterCode: req.query.recruiterCode,
  priority: req.query.priority,
  requestId: req.query.requestId || null,
})));

router.get('/requests', h((req) => listRequests(req.user, { status: req.query.status, scope: req.query.scope })));
router.post('/requests', h(async (req, res) => {
  const result = await createRequest(req.user, body(req));
  res.status(201).json(result);
}));
router.get('/requests/:id', h((req) => requestDetail(req.user, req.params.id)));
router.patch('/requests/:id', h((req) => updateRequest(req.user, req.params.id, body(req))));
router.post('/requests/:id/submit', h((req) => transition(req.user, req.params.id, 'submit', { comment: body(req).comment })));
router.post('/requests/:id/review', h((req) => review(req.user, req.params.id, body(req))));
router.post('/requests/:id/approve', h((req) => approve(req.user, req.params.id, body(req))));
router.post('/requests/:id/assign', h((req) => assign(req.user, req.params.id, body(req))));
router.post('/requests/:id/priority', h((req) => changePriority(req.user, req.params.id, body(req))));
router.post('/requests/:id/extend', h((req) => extend(req.user, req.params.id, body(req))));
router.post('/requests/:id/hold', h((req) => transition(req.user, req.params.id, 'hold', { comment: body(req).comment })));
router.post('/requests/:id/resume', h((req) => transition(req.user, req.params.id, 'resume', body(req))));
router.post('/requests/:id/cancel', h((req) => transition(req.user, req.params.id, 'cancel', { comment: body(req).comment })));
router.post('/requests/:id/accepted', h((req) => recordAccepted(req.user, req.params.id, body(req))));
router.get('/requests/:id/odoo', h((req) => requestPipeline(req.user, req.params.id, { forceRefresh: req.query.refresh === '1' })));
router.put('/requests/:id/odoo-link', h((req) => linkOdooJob(req.user, req.params.id, { jobId: body(req).jobId ?? null })));

router.get('/odoo', h((req) => recruitmentOdooOverview(req.user, { forceRefresh: req.query.refresh === '1' })));
router.get('/odoo/pipelines', h((req) => pipelineSummaries(req.user)));

router.get('/kpi', h((req) => kpiOverview(req.user, { period: req.query.period })));
router.get('/kpi/:employeeCode', h((req) => kpiDetail(req.user, req.params.employeeCode, { period: req.query.period })));
router.post('/kpi/events', h(async (req, res) => {
  const result = await createKpiEvent(req.user, body(req));
  res.status(result.duplicate ? 200 : 201).json(result);
}));
router.post('/kpi/events/:id/void', h((req) => voidKpiEvent(req.user, req.params.id, body(req))));

router.get('/rewards', h((req) => rewardsOverview(req.user)));
router.post('/rewards/batches/:id/decision', h((req) => decideRewardBatch(req.user, req.params.id, body(req))));

// The short form the API contract names: PUT /api/hr/recruitment/:id/odoo-link.
router.put('/:id/odoo-link', h((req) => linkOdooJob(req.user, req.params.id, { jobId: body(req).jobId ?? null })));

export default router;
