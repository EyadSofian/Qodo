# Task Workflows

## Implemented default flow

```text
Task created and assigned
→ assignee accepts / requests a change
→ work starts
→ deliverable is attached
→ submit for review
→ manager approves and scores
   or requests changes with a reason
→ assignee resubmits
→ approved
```

Assignment responses:

- accept;
- decline with reason;
- request clarification with reason;
- propose a new due date;
- request reassignment with reason.

Submission and approval are actions, not writable status fields. Direct
Kanban/API writes cannot bypass their requirements. Full endpoint and legacy
workflow detail remains in `docs/TASK_FLOW.md`.

## Not implemented

Admin-configurable workflow versions, per-task-type transitions, required
checklists, reviewer/approver assignment, SLA changes, transition conditions
and automation triggers are future work.
