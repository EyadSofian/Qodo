# Scoring Model

## Current production calculation

- A manager approves a submitted task with one score from 0 to 100.
- The assignee sees their own score; coworkers receive a masked value.
- Managers see their department; administrators see their organization.
- Period average is weighted by effort points:

```text
Employee average =
sum(task score × task effort points)
÷
sum(task effort points)
```

An unestimated scored task receives a neutral weight of 1.

## Limits

The current score is not the six-component rubric described in the supplied
specification. It does not yet exclude blocked/client-waiting time, allocate
contributor shares, attach evidence per component, version rubrics, audit
adjustments or support appeals.

It must not be used alone for compensation or disciplinary decisions until
those fairness controls exist.
