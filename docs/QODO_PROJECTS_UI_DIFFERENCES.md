# Qodo Projects — Deliberate differences from Zoho Projects

The brief asks for parity of *information architecture, workflow and
interaction*, explicitly **not** of branding, colour or code. This file records
every place we knowingly diverge, and why. A difference that is not here is a
bug, not a decision.

Reference: Zoho Projects "Infinity", audited 2026-09-05.

---

## 1. Visual identity — divergent by instruction

| | Zoho | Qodo |
| --- | --- | --- |
| Primary | Zoho red/orange | Navy `#0B2545`, brand blue `#1D6FB8` |
| Accent | — | Orange `#F5821F`, CTA and highlight only |
| Surface | white/grey | `#F6F8FB` wash, `#FFFFFF` cards, `#E6ECF3` lines |
| Type | Zoho's stack | Cairo / Tajawal, Arabic-first |
| Logo | Zoho | ENGOSOFT, from `/public` |

No Zoho logo, trademark, icon or illustration is used anywhere. The layout is
structurally comparable; the material is entirely ENGOSOFT.

---

## 2. Arabic-first, where Zoho is English-first

Zoho added RTL to its **mobile** apps in June 2025. Qodo Projects is
Arabic-first and RTL-first on every surface from the first commit, and Arabic is
the default language.

Consequences that are visible differences rather than translations:

- The default working week is **Sunday–Thursday** (`{7,1,2,3,4}`), not
  Monday–Friday. Every duration, critical path and SLA clock in the product
  counts Engosoft's week. A tool that assumed Mon–Fri would produce plausible,
  wrong dates for every project in the company.
- Layouts mirror through logical properties (`ms-`, `ps-`, `text-start`), so
  nothing is positioned left or right explicitly and both directions are the
  same code path rather than two.

**This is a difference in our favour and we are keeping it.**

---

## 3. The Qodo review lifecycle — an addition, not a substitution

Qodo's existing task contract — assign → accept/decline/clarify/propose date →
work → submit evidence → review → request rework → resubmit → approve → score —
has no equivalent in Zoho, whose tasks move between statuses without a
two-sided contract.

It is **kept** and mapped onto project tasks rather than replaced. Zoho parity
is the floor here, not the ceiling: removing a working accountability model to
match a product that lacks one would be a downgrade sold as parity.

---

## 4. Sandbox: versioned draft/publish instead of a duplicate environment

Zoho ships a Sandbox as a separate environment. Qodo implements versioned
configuration with an explicit draft → publish → rollback (ADR-9).

**Why.** The risk being managed is "a bad layout reaches everybody", not "a test
writes to real data". Duplicating storage, users and integrations for a
single-tenant Railway deployment is cost without a matching safety gain, and
versioning gives the same protection plus something Zoho's sandbox does not: a
record remembers the configuration version it was created under, so publishing a
new blueprint cannot retroactively invalidate history.

---

## 5. CodeX Scripts: sandboxed and quota'd, no cloud editor

Zoho's Developer Space offers CodeX Scripts (JavaScript, a published JS SDK,
metered credits) *and* a full extension platform with a cloud editor and a
marketplace.

Qodo implements the script runner — sandboxed, versioned, timed out, quota'd,
audited, behind a permission no built-in set carries (ADR-10). It does **not**
implement a marketplace or a cloud IDE. An internal tool for one organization
does not need a third-party extension economy, and building the review and
sandboxing an extension marketplace requires is a product in itself.

---

## 6. Custom domain: not applicable

Zoho maps a customer domain onto a portal. Qodo Projects is one module of one
internal workspace on one deployment. There is no portal to map.

---

## 7. Mobile: responsive PWA, not native apps

Zoho ships native iOS and Android apps with offline time logs, home-screen
widgets and voice notes.

Qodo Projects is a responsive PWA on the workspace's existing service worker.
The brief (§75) asks for a strong responsive experience rather than shrunk
desktop screens, and that is what is built:

- tables scroll inside their own container — the page body never scrolls
  sideways;
- Kanban stays horizontally scrollable;
- Gantt gets a simplified, read-mostly timeline on small screens;
- tabs collapse into a horizontally scrolling strip.

Offline time logging and native widgets are **not** available.

---

## 8. Chat and calendar: reused, not rebuilt

Zoho Projects has its own project chat and its own project calendar (with a
Zoho Cliq integration alongside).

Qodo reuses **Qodo Mail** conversations and **Qodo Calendar** events (ADR-8).
The brief (§41, §52) asks for exactly this, and the audit found both ready:
Mail already separates membership from conversation, Calendar already separates
the per-person invite from the event. Two chat systems would mean two unread
counts, two notification paths and two search sources.

**Visible difference:** project discussion opens the Mail surface scoped to the
project rather than a separate in-page chat panel.

---

## 9. Projects needs a database; the rest of the workspace does not

Every other Qodo module runs against a JSON file with zero setup. Projects
requires PostgreSQL and returns `503` with the exact `docker run` command when
`DATABASE_URL` is unset.

**Why.** A JSON fallback would mean every query written twice — once in SQL,
once as a JavaScript filter — and the two drifting the first time one was fixed.
§83 forbids that duplication, and ADR-2 explains why the relational schema is
not optional for this module.

**Visible difference:** a developer who has not configured a database sees a
clear, actionable error on `/projects` while the rest of the workspace works
normally.

---

## 10. Zoho-ecosystem integrations

Zoho Projects integrates deeply with Zoho CRM, Desk, Books, Invoice, Cliq,
People, Analytics, Sprints and Flow. Qodo has no equivalent product for most of
these, and the first-party replacements are:

| Zoho | Qodo |
| --- | --- |
| Zoho People (leave → capacity) | **Qodo HR** |
| Zoho Cliq / Mail | **Qodo Mail** |
| Zoho Books / Invoice | **Odoo**, via the existing connector |
| Zoho Analytics | Qodo reports and dashboards |
| Zoho Sprints | Not planned — no agile product to integrate with |

Third-party adapters (Google, Microsoft, GitHub/GitLab/Gitea/Bitbucket, Slack,
generic webhooks) follow the connector framework in ADR-11. An adapter with no
credentials reports **Not connected** and returns
`409 integration_not_configured` — it never pretends.

---

## 11. Differences still to be decided

Recorded now so they are decisions later rather than accidents:

- **Task groups** (Zoho, Aug 2025) — grouping by any field is planned; whether
  groups are collapsible-and-persisted per view is open.
- **Colour coding** — Zoho colours projects, phases, task lists and tasks. Qodo
  carries `color` on all four; how loudly the Kanban uses it is a density
  decision not yet made.
- **Automation credits** — Zoho meters automation runs commercially. Qodo needs
  the quota as a runaway-loop guard, not as a billing device, so the default
  ceiling will be generous.
