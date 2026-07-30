# Organization and Marketing Structure

## Implemented hierarchy

```text
Organization: Engosoft
└── Department: Marketing
    ├── Creative
    │   ├── Designer
    │   ├── Video Editor
    │   └── Content Creator
    ├── Marketing
    │   ├── Social Media
    │   ├── Marketing Specialist
    │   ├── Digital Marketing Specialist
    │   ├── Marketing Coordinator
    │   └── Digital Marketing Coordinator
    ├── Website & E-commerce
    │   ├── E-commerce Manager
    │   ├── E-commerce Specialist
    │   ├── SEO Specialist
    │   └── Web Developer
    ├── Merchandising
    │   └── Merchandiser
    └── Performance
        └── Media Buyer
```

Access role, department, subteam and job role are separate fields. A Media
Buyer does not become a manager merely because of the job title.

## Current access behavior

Visibility has four scopes, narrowest first: `own`, `subteam`, `department`,
`all`. A user's `visibilityScope` field selects one; leaving it null follows the
role, which is what every account did before the field existed.

The scope can only narrow. `visibilityFor` caps the request against a ceiling
derived from permissions — `all` needs `tasks.view_all`, `department` needs
`tasks.view_team` — so setting a wider scope on a member grants nothing.

- An employee or viewer sees the department board, or one branch of it when
  their scope is `subteam`.
- Work assigned to or created by a person is always visible to them, whatever
  the scope. A `subteam` user does not see department-wide tasks (`subteam:
  null`) unless they are on them.
- A manager sees and edits their department and can export its tasks.
- An administrator sees all departments inside their organization.
- An employee sees only their own performance score; a manager sees the
  department's.
- Assignment pickers and the directory follow the same scope.

## Joining

An administrator creates an invite link from the Users page. Whoever opens it
sets their own name, email and password and picks their department, sub-team and
job role. The account is created as `pending`: no session, no permissions, and
`account_pending` on login until an administrator approves it. Role, permissions,
allowed apps and visibility scope come from the link, never from the join form,
and a link can only ever create `member` or `viewer`.

## Not implemented

Sub-team managers, multiple team memberships, manager hierarchy, membership
history, admin-managed job titles/categories/disciplines/skills/seniority and
inactive organizational units remain future work. The current marketing tree is
a stable code-managed configuration.
