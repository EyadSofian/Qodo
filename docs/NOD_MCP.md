# MCP endpoint for Nod

`POST /api/mcp` is a stateless MCP server (Streamable HTTP, JSON responses) for outside agents such as Nod. It offers the workspace assistant's own tools from `server/assistant/tools.js`, so permissions are checked exactly as in the in-app assistant.

## Who Nod acts as

Calls run as one real workspace account, named by `NOD_MCP_USER_EMAIL`. Nod sees and changes only what that account can. Create a dedicated account (for example `nod@engosoft.com`) and give it only the departments and apps Nod should reach. Disabling the account stops the endpoint at once.

## Tools

Reads: `list_projects`, `project_health`, `project_overdue_work`, `project_workload`, `list_apps`, `list_departments`, `search_tasks`, `task_summary`, `decision_brief`, `list_team`, `recent_activity`, `insights_metrics`, `support_metrics`.

Action: `create_task`. In the app the assistant waits for a Confirm click; over MCP, Nod's own approval check takes that place.

## Enable it

1. Generate a token: `openssl rand -base64 32`.
2. On Railway set `NOD_MCP_TOKEN`, `NOD_MCP_USER_EMAIL` and optionally `NOD_MCP_LANG` (`ar` or `en`), then redeploy. Without the first two the endpoint answers 503.
3. In Nod: **Apps → Connect MCP**, name `Engosoft Workspace (Qodo)`, URL `https://<workspace host>/api/mcp`, choose an access token and paste the same value.

The route is mounted before the session-cookie and HR-workspace guards, because it authenticates with the bearer token instead.
