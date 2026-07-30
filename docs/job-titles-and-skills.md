# Job Titles and Skills

The current marketing job-role values are defined in
`shared/departments.js`. They provide a stable employee/task filter but are not
an admin-managed catalog.

No production Skills module exists. Proficiency, years of experience,
verification, certification and last-used date are not stored.

Before task-assignment suggestions are added:

1. create versioned job-title, category, discipline and skill catalogs;
2. store user-skill relationships independently;
3. keep skills advisory—never auto-assign without manager confirmation;
4. preserve inactive values on historical users/tasks;
5. add tenant and permission checks to every catalog endpoint.
