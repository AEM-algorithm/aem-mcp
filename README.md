# aem-mcp

MCP server for AEM Journaler. Exposes customer data and commands to the chatbot via the [Model Context Protocol](https://modelcontextprotocol.io/).

## Architecture

```
chatbot (MCP client)
  → aem-mcp (this repo, Streamable HTTP)
    → aem-backend REST API
```

## Repos in the epic

| Repo | Role |
|------|------|
| **aem-mcp** | MCP transport, tool catalog, handlers |
| **aem-backend** | Business logic and REST APIs |
| **chatbot** | MCP client + LangChain tools |
| **aem-frontend** | Optional tool-activity UI |

## Quick start

Full local setup (aem-mcp + chatbot wiring): [docs/SETUP_AND_CHATBOT_INTEGRATION.md](docs/SETUP_AND_CHATBOT_INTEGRATION.md).

```bash
cp .env.example .env
npm install
npm run dev
```

## External Agent Authentication

External agents (Claude Code, ChatGPT, Codex, Cursor, custom clients) connect to `aem-mcp` via OAuth 2.0 Device Authorization Grant (RFC 8628). See [docs/EXTERNAL_AGENT_CONNECTORS.md](docs/EXTERNAL_AGENT_CONNECTORS.md) for connector configuration for each client, plus troubleshooting and workarounds for non-compliant clients.


Default port: `3000`. If aem-backend already uses `3000`, set `PORT=3002` and point chatbot `AEM_MCP_URL` at that port.

Endpoints:

- `GET /health` — liveness
- `GET /ready` — readiness
- `POST /mcp` — Streamable HTTP MCP (auth: `Authorization: Bearer <jwt>` or `Cookie: token=...`)

Generate a dev session token from aem-backend:

```bash
cd ../aem-backend && npx tsx -r dotenv/config scripts/create-session-token.ts 390
```

## Tool catalog

Tool definitions and metadata live in `catalog/aem-tool-metadata.yaml` (DEV-3912).

**Current policy:** read-only tools only (`policy.writes_enabled: false`). No create, update, delete, sync, label apply, rule create, or export triggers.

**Agent guidance:** `catalog/aem-agent-system-prompt.md` — paste into chatbot system prompt when MCP is enabled. Example user journeys are in `aem-tool-metadata.yaml` under `example_user_journeys`.

**Guardrails (DEV-3913):** enforced in `src/guardrails/` before backend calls — pagination defaults, `list_transactions` filters, and blocked slow tools (`get_transaction_summary`).

## Related tickets

- DEV-3911 — epic
- DEV-3912 — tool catalog v1
- DEV-3913 — MCP server Phase 0
