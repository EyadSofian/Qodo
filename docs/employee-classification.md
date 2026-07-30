# Employee Classification

## Implemented fields

- access role;
- organization;
- primary department;
- optional marketing subteam;
- optional job role;
- free-text title;
- active/disabled status.

These fields are independent. Permissions come from the access role or explicit
permission override, never from the job role.

## Missing fields

Branch, manager, employee code, employment type/status, category, discipline,
seniority, skills, certifications, capacity, work schedule, availability,
joining date, leave, timezone, language, bio and restricted internal notes are
not implemented.

The next data model should use membership/history records rather than adding
another overloaded role column.
