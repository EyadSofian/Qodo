# Project and Task Roles

## Current state

There is no Project entity or project membership. A task currently has:

- requester/creator (`createdBy`);
- one primary assignee (`assigneeId`);
- department managers as reviewers.

## Required model

Project membership must be independent of the organization role and carry role,
start/end date, inviter, active status and history.

Task responsibility should then store requester, exactly one accountable owner,
primary assignee, contributors and percentages, reviewers, approvers, watchers,
consulted and informed users. Contribution shares must total 100% whenever they
affect scoring.

This model is not implemented and must precede client projects and multi-person
score allocation.
