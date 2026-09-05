# Qodo Projects — AI

> **Status: design, not implementation.** Nothing here is built. Scheduled for
> Phase 10. The foundation it builds on — `server/ai/`, `server/assistant/`,
> and the existing provider abstraction over `@anthropic-ai/sdk` and `openai` —
> **does** exist and is in the repository today.

Reference: Zoho Projects "Infinity" AI Hub, audited 2026-09-05.

---

## 1. What the audit found

The AI story changed more than any other area since the brief was written.

| Zoho, current | Detail |
| --- | --- |
| **AI Hub** | Connect Zia, ChatGPT **or Gemini**; capabilities available across the product |
| Task summary | Summarises long descriptions and comment threads |
| AI task creation | Suggests tasks from project details |
| **MCP** | A real Model Context Protocol server: bidirectional LLM access to files, work items and discussions |
| Zia insights | Bottlenecks, anomalies, deadline risk, surfaced on reports and dashboards |
| Custom modules with AI | Generate a module definition (June 2026) |
| Weekly time-log suggestions | Suggests time from assigned tasks and working hours (July 2026) |
| Natural-language search | Across project content |
| Translation | Between supported languages |

Two consequences for this design: the brief's "do not hardwire one provider"
rule is not merely good practice, it is **what the reference product does**; and
MCP is table stakes rather than "where useful".

---

## 2. Three rules that gate everything

Every capability below is subordinate to these. A feature that cannot satisfy
all three does not ship.

### 2.1 The same permission boundary as the UI

AI runs **as the asking user**. It sees exactly what that person would see by
clicking, and nothing else.

Concretely: retrieval starts from `visibleProjectIds(user)` and every record
passes `maySee` and `projectFields` on the way into the prompt. A client asking
about their project must not receive a summary that draws on an internal
comment, a rate or another customer's work.

This is the single largest risk in the module. An AI layer that queries the
database directly, "because it needs context", is a permission bypass with a
friendly interface. **The retrieval path is the authorization path** — there is
no second one.

### 2.2 Grounded, or silent

Every insight cites the records it came from, and the UI shows them. If the
inputs for a number are not present, the answer says so.

§51's rule for earned value applies to the whole AI surface: **never invent a
metric.** A confident number with no source is worse than no answer, because a
manager acts on it.

### 2.3 Preview before writing

Anything that creates or modifies records shows what it will do and waits.
"Turn this brief into tasks" produces a reviewable list, not fourteen rows and a
notification.

---

## 3. Provider abstraction

`server/ai/` already fronts more than one provider. Projects adds a capability
registry on top:

```
capability  →  prompt template + retrieval plan + output schema
            →  provider selected by configuration
            →  validated against the schema
            →  rejected if it does not parse
```

An unparseable response is a failure, not a string to render. The output schema
is what stops a hallucinated field name from reaching a write path.

Configuration lives in Settings → AI, behind `settings.manage`. An unconfigured
provider means the capability reports **unavailable** — never a silent fallback
to a worse model, and never a fabricated answer.

---

## 4. The capabilities

| Capability | Reads | Writes | Notes |
| --- | --- | --- | --- |
| Summarise task / issue | description, comments, activity | — | Cites the comment range |
| Summarise project | phases, tasks, issues, budget | — | Numbers come from queries, never from the model |
| Generate description / acceptance criteria | the record | drafts into the field | Person edits before saving |
| Task creation from natural language | project context | **preview only** | §3 |
| Semantic search | everything the user may see | — | Answers cite records |
| Translate | the record | drafts | Arabic ↔ English |
| Insights | metrics from SQL | — | Model *explains* numbers it is given; it does not compute them |
| Duplicate detection | titles/descriptions in scope | — | Warns at create time |
| Weekly time suggestions | assignments, working calendar | **preview only** | Following Zoho, July 2026 |
| Voice input | — | — | Browser `SpeechRecognition`; unavailable elsewhere, and says so |

The **insights** row carries the important distinction: the model receives
figures that SQL computed and writes the sentence. It never does the arithmetic.
That is what makes "three projects are at risk" checkable.

---

## 5. MCP

Expose Qodo Projects as MCP tools and resources so an external assistant can
work with real project data.

- **Tools** map to existing service functions — the same authorization, the same
  validation, the same audit. No tool reaches the database directly.
- **Every call carries the authenticated user.** An MCP session is not a service
  account; there is no "MCP user" with elevated rights.
- **Writes are audited with `source = 'api'`** and are subject to Blueprint and
  workflow rules exactly as a browser request is.
- Read tools are enabled first. Write tools follow only once the authorization
  tests cover them.

---

## 6. What is deliberately not planned

- **Autonomous agents** that reassign work, replan resources or change budgets
  without a person. Zoho lists these as upcoming; Qodo will not ship them until
  the audit, permission and preview layers underneath have been in production
  long enough to be trusted with irreversible decisions.
- **Training on workspace data.** Content is sent to a configured provider for
  inference and nothing else.
- **AI-authored automation that self-publishes.** Generating a draft module or
  rule is fine; publishing it is a person's action under
  `customization.manage`.

---

## 7. Definition of done for this phase

- A leakage test: a client user asks a question whose honest answer lives in an
  internal comment, and does not receive it.
- A grounding test: every insight response carries record ids that exist and
  that the asking user may read.
- A schema test: a malformed model response is rejected rather than rendered.
- A preview test: no AI capability writes a record without an explicit
  confirmation step.
- An MCP authorization test: a tool call from a user without the permission is
  refused with the same status the HTTP route would give.
