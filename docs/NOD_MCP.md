# MCP endpoint for Nod

`POST /api/mcp` is a stateless MCP server (Streamable HTTP, JSON responses) for outside agents such as Nod. It offers the workspace assistant's own tools from `server/assistant/tools.js`, so permissions are checked exactly as in the in-app assistant.

## Who Nod acts as

Calls run as one real workspace account, named by `NOD_MCP_USER_EMAIL`. Nod sees and changes only what that account can. Create a dedicated account (for example `nod@engosoft.com`) and give it only the departments and apps Nod should reach. Disabling the account stops the endpoint at once.

## Tools

Reads: `list_projects`, `project_health`, `project_overdue_work`, `project_workload`, `list_apps`, `list_departments`, `search_tasks`, `task_summary`, `decision_brief`, `list_team`, `recent_activity`, `insights_metrics`, `support_metrics`.

Full reads of every module: `qodo_list_endpoints` lists every GET route read from the live router (HR, recruitment, offers, KPI, tasks, projects, learning production, events, calendar, management, booking, offices, prices, users, activity), and `qodo_get` returns the full JSON of one, paged when large. Left out: Qodo Mail and chat (owner's decision, 2026-11-25), sign-in, invitations, push, live streams and file downloads (`server/mcpCatalog.js`). `qodo_get` calls this server over loopback as the MCP account (`server/internalCaller.js`: a random per-process key, accepted only from 127.0.0.1), so each route's own permission checks apply and no session is created.

Action: `create_task`. In the app the assistant waits for a Confirm click; over MCP, Nod's own approval check takes that place.

## Personal keys (Settings → MCP keys)

Admins create one key per person or agent. Each key names, per dashboard (Qodo, Insights Hub, Mobde3), everything, nothing or a list of sections (HR, KPI, tasks, projects…; ads & campaigns, CRM, sales, P&L; analytics, calendar, content, team), whether actions are allowed, and an optional expiry. Only the SHA-256 hash is stored; the key is shown once. Revoking stops it on the next request.

Enforcement is in Qodo (`server/mcpScopes.js`), before anything is forwarded: tools outside the scope are not listed, listings are filtered, and `*_get` / `insights_read` calls are checked against the sections' paths and surfaces. Anything no section claims is refused when a dashboard is restricted. Every call records the key's name in the activity log (Settings → Activity → MCP requests).

`NOD_MCP_TOKEN` still works as the full-access master key; rotate it in Railway to stop it.

## One endpoint for every dashboard

`/api/mcp` also lists and forwards the tools of the Insights Hub and Mobde3 (Social Pulse) MCP servers (`server/mcpGateway.js`), so Nod needs one URL and one token. Set on Railway:

- `INSIGHTS_MCP_TOKEN`: the Insights Hub `NOD_MCP_TOKEN`. The URL defaults to `INSIGHTS_HUB_URL` + `/api/mcp`; override with `INSIGHTS_MCP_URL`.
- `PULSE_MCP_URL` (`https://web-production-d07de.up.railway.app/api/mcp`) and `PULSE_MCP_TOKEN`: the Mobde3 `NOD_MCP_TOKEN`.

An upstream that is not set or not answering contributes no tools; the workspace tools keep working. Tool lists are cached for five minutes.

## Enable it

1. Generate a token: `openssl rand -base64 32`.
2. On Railway set `NOD_MCP_TOKEN`, `NOD_MCP_USER_EMAIL` and optionally `NOD_MCP_LANG` (`ar` or `en`), then redeploy. Without the first two the endpoint answers 503.
3. In Nod: **Apps → Connect MCP**, name `Engosoft Workspace (Qodo)`, URL `https://<workspace host>/api/mcp`, choose an access token and paste the same value.

The route is mounted before the session-cookie and HR-workspace guards, because it authenticates with the bearer token instead.
