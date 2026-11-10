# HR-only invitations

An account with the explicit app list `['hr']` and a non-admin role is restricted
to the HR module. The API checks this before any module router; the UI redirects
other module URLs to HR and hides Mail, Calendar, search and the assistant.
Identity, notifications, push, the HR app registry, HR, KPI and the seating plan
remain available. HR's individual permissions still govern every HR operation.
Existing multi-app accounts and admins keep their existing access.

Do not grant `hr.payroll` or `hr.manage` to recruiters who must not read payroll.
Use explicit HR view, recruitment view/request/assign/offers and personnel
view/manage keys as needed. Without payroll access, these accounts cannot open
payroll, import or change payroll datasets, or read salary and bank values from
their own employee profile. Offer compensation is part of the job offer workflow
and is separate from employee payroll.

`POST /api/invites` supports optional `email`, `subteam` and `jobRole` fields.
`email` binds a link to one address; it is checked in the shared password/Google
acceptance path. A pinned subteam needs exactly one department, and a pinned job
role must belong to it. The join page prefills the address and placement, and
shows only the allowed organizational branch. Anonymous invite reads do not
disclose role, permissions or app access.

Use a separate one-use, expiring invitation per person. Registration remains
pending until an administrator approves it from Users. Named invitations do not
bypass approval or automatically sign someone in. No password is assigned by
the invitation creator. The recipient chooses a password or uses the exact
invited Google identity; credentials are never embedded in the invitation URL.

Validation: the HR integration suite exercises restricted-email and placement
checks, consumed links, pending approval, signup privilege escalation attempts,
post-approval app isolation, and payroll redaction on a linked self profile.
