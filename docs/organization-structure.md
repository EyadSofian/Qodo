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

- An employee or viewer sees only the department board.
- A manager sees and edits their department and can export its tasks.
- An administrator sees all departments inside their organization.
- An employee sees only their own performance score.
- A manager sees department performance.

## Not implemented

Branches, multiple team memberships, manager hierarchy, membership history,
admin-managed job titles/categories/disciplines/skills/seniority and inactive
organizational units remain future work. The current marketing tree is a stable
code-managed configuration.
