# Testing and Verification

## Available commands

```bash
npm install --no-audit --no-fund
npm run typecheck
npm test
npm run build
git diff --check
```

There is no configured lint or formatting script in `package.json`; therefore
no lint/format result should be claimed.

## Integration coverage

`server/tasks.integration.test.js` starts a real Express server against an
isolated temporary file store and covers:

- organization policy rejects cross-tenant task/person access;
- marketing and sales department boundaries;
- employee score privacy and manager team performance;
- safe manager CSV export;
- score cannot be written before review;
- Kanban writes cannot bypass submission or review gates;
- assignment cannot start before assignee acceptance;
- assignment reason validation and event history;
- deliverable-required submission;
- employee cannot approve own work;
- rework requires a reason and increments the return counter;
- resubmission, approval, score and download;
- review queue, first-pass and on-time metrics.

## Verification result on 2026-07-30

- TypeScript: passed.
- Node integration tests: 6 passed, 0 failed.
- Vite production build: passed.
- Diff whitespace check: passed; Git reported only line-ending warnings.

## Missing coverage

- Playwright end-to-end suite in CI;
- PostgreSQL backend parity tests;
- browser accessibility automation;
- concurrency/transaction tests;
- future project/client/asset/automation/capacity/scoring-rubric modules.
