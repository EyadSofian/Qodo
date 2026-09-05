/**
 * Qodo Projects — budget, cost and earned-value routes.
 *
 * Mounted under `/api/projects/:projectId/budget`. Rates live behind their own
 * permission, separately from the budget itself: whether the project is over
 * budget is a project-management question, and what a colleague earns is not.
 */

import { Router } from 'express';
import * as budget from '../../projects/budgetService.js';
import { handler } from './handler.js';
import { permit, withProject } from './guards.js';
import { PROJECT_PERMISSIONS as P } from '../../../shared/projects/permissions.js';

const router = Router({ mergeParams: true });

router.use(handler(withProject));

router.get(
  '/',
  permit(P.BUDGET_VIEW),
  handler(async (req, res) => {
    res.json(await budget.status(req.projectContext));
  })
);

router.put(
  '/',
  permit(P.BUDGET_MANAGE),
  handler(async (req, res) => {
    res.json({ budget: await budget.setBudget(req.projectContext, req.body) });
  })
);

/**
 * Earned value.
 *
 * Answers `available: false` with a list of what is missing rather than
 * computing around a gap — §51 forbids inventing the inputs, and an SPI derived
 * from a guessed budget is worse than none because somebody acts on it.
 */
router.get(
  '/earned-value',
  permit(P.REPORTS_FINANCE),
  handler(async (req, res) => {
    res.json(await budget.earnedValue(req.projectContext));
  })
);

router.get(
  '/expenses',
  permit(P.BUDGET_VIEW),
  handler(async (req, res) => {
    res.json({ expenses: await budget.expenses(req.projectContext) });
  })
);

router.post(
  '/expenses',
  permit(P.BUDGET_MANAGE),
  handler(async (req, res) => {
    res.status(201).json({ expense: await budget.addExpense(req.projectContext, req.body) });
  })
);

router.put(
  '/rates/:kind',
  permit(P.RATE_MANAGE),
  handler(async (req, res) => {
    const kind = req.params.kind === 'bill' ? 'bill' : 'cost';
    res.json({ rate: await budget.setRate(req.projectContext, kind, req.body) });
  })
);

export default router;
