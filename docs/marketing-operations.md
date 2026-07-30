# Marketing Operations

## Implemented slice

The Marketing department has a team tree, marketing-specific task statuses,
department access control, table/Kanban/review/performance views and export.

## Missing product modules

Client, brand, campaign, marketing request, brief, deliverable, content item,
publishing schedule, paid-media account, UTM, metric snapshot, KPI and report
entities are not implemented.

Recommended implementation order:

```text
Project authorization
→ Client and Brand
→ Campaign
→ Marketing Request and Brief
→ Deliverable/Content Item
→ Asset Version and Approval
→ Publishing
→ Metrics and Reports
```

No marketing page should be added until its records, server authorization and
tenant-negative tests exist.
