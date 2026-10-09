# AEM MCP — Local Setup & Chatbot Integration

Guide to run **aem-mcp** itself and wire it into the **chatbot** so agents can read customer Journaler data over MCP.

**Epic:** [DEV-3911](https://app.clickup.com/t/86d3bhve2) — Chatbot customer data & commands (MCP architecture)  
**Related:** DEV-3912 (catalog), DEV-3913 (MCP server), DEV-3914 (JWT/session), DEV-3915 (`AemMcpClient` + LangChain tools)

---

## Architecture

```
aem-frontend (optional tool activity UI)
        │
        ▼
chatbot (MCP client — AemMcpClient / AemMcpTool)
        │  POST /mcp  Authorization: Bearer <session JWT>
        ▼
aem-mcp (this repo — Streamable HTTP transport + tool catalog)
        │  REST with same JWT (Cookie/Bearer)
        ▼
aem-backend (business logic + PostgreSQL)
```

| Repo | Role |
|------|------|
| **aem-mcp** | MCP transport, tool registry, guardrails; proxies to backend |
| **aem-backend** | Auth, company scope, REST APIs |
| **chatbot** | LangChain agent; loads MCP tools when `AEM_MCP_ENABLED=true` |
| **aem-frontend** | Passes session JWT + `activeCompanyId` into chat |

**Current policy:** read-only (`policy.writes_enabled: false` in `catalog/aem-tool-metadata.yaml`). No sync, create/update/delete, label apply, or export triggers via MCP.

---

## Prerequisites

1. **Node.js ≥ 18** (aem-mcp)
2. **aem-backend** running locally (default `http://localhost:3000/api`)
3. **chatbot** running (often Docker on port `3001`)
4. Matching **JWT secret** across aem-backend, aem-mcp, and chatbot (local default: `1234`)
5. A **Pro/Premium** test user with AI Analytics access (free tier does not get MCP personal-data tools)

---

## Part 1 — Set up aem-mcp

### 1. Clone / open repo

```bash
cd /path/to/aem-mcp
```

### 2. Environment

```bash
cp .env.example .env
```

| Variable | Meaning | Local recommendation |
|----------|---------|----------------------|
| `PORT` | HTTP listen port | Use **`3002`** if aem-backend already uses `3000` (README default is `3000`) |
| `NODE_ENV` | `development` / `production` | `development` |
| `AEM_BACKEND_URL` | Backend API base | `http://localhost:3000/api` |
| `JWT_SECRET` | Must match aem-backend session secret | `1234` in local/dev |

Example local `.env`:

```bash
PORT=3002
NODE_ENV=development
AEM_BACKEND_URL=http://localhost:3000/api
JWT_SECRET=1234
```

### 3. Install & run

```bash
npm install
npm run dev
```

You should see: `aem-mcp listening on 0.0.0.0:3002` (or your `PORT`).

### 4. Smoke checks

```bash
curl -s http://localhost:3002/health
# {"status":"ok","service":"aem-mcp"}

curl -s http://localhost:3002/ready
# {"status":"ready","service":"aem-mcp"}
```

### 5. Auth against `/mcp`

MCP requires a session JWT from aem-backend:

```bash
cd ../aem-backend
npx tsx -r dotenv/config scripts/create-session-token.ts 390
# or: npm run create-session-token -- 390
```

Then:

```bash
TOKEN='<paste jwt>'

curl -s -X POST "http://localhost:3002/mcp" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Accepted auth headers (same as backend session style):

- `Authorization: Bearer <jwt>`
- or `Cookie: token=<jwt>`

Without a valid token → `401`.

### 6. Tool catalog & agent guidance

| File | Purpose |
|------|---------|
| `catalog/aem-tool-metadata.yaml` | Tool names, backend paths, filters, example journeys |
| `catalog/aem-agent-system-prompt.md` | End-user-facing agent discipline (also mirrored in chatbot prompts) |
| `src/guardrails/` | Pagination defaults, required filters, blocked slow tools |

### 7. Docker (optional)

```bash
docker build -t aem-mcp:local .
docker run --rm -p 3002:3000 \
  -e NODE_ENV=development \
  -e AEM_BACKEND_URL=http://host.docker.internal:3000/api \
  -e JWT_SECRET=1234 \
  -e PORT=3000 \
  aem-mcp:local
```

Production image notes live in the repo `Dockerfile` (`JWT_SECRET` required when `NODE_ENV=production`).

---

## Part 2 — Add / enable MCP in the chatbot

Chatbot already contains the MCP client (DEV-3915). You mainly **configure and verify**.

### Code map

| Path | Role |
|------|------|
| `app/services/agent_service/tools/AEM_tool/mcp_client.py` | `AemMcpClient` — Streamable HTTP JSON-RPC; JWT enrich with `companyId` |
| `app/services/agent_service/tools/AEM_tool/mcp_tools.py` | `AemMcpTool` + `build_aem_mcp_tools()` |
| `app/services/agent_service/tools/manager.py` | Loads MCP tools for Pro/Premium when enabled; falls back to legacy REST AEM tools |
| `app/services/agent_service/prompts/__init__.py` | Appends MCP system-prompt snippet when enabled |
| `app/core/config.py` | `aem_mcp_enabled`, `aem_mcp_url`, `aem_mcp_timeout_ms`, `aem_jwt_secret` |
| `app/api/routes/streaming.py` | Accepts `token` query param (JWT) for the stream route |
| `tests/test_aem_mcp_client.py` | Client unit tests |
| `docs/MCP_USER_HISTORY_SCENARIOS.md` | Eval / smoke question pack (read-only) |

### 1. Chatbot env

In `chatbot/.env` (see `.env.example`):

```bash
# Feature flag — Pro/Premium use MCP instead of legacy AEM REST tools
AEM_MCP_ENABLED=true

# Streamable HTTP MCP endpoint
# Chatbot in Docker → host aem-mcp on 3002:
AEM_MCP_URL=http://host.docker.internal:3002/mcp
AEM_MCP_TIMEOUT_MS=30000

# Must match aem-backend and aem-mcp (injects companyId into session JWT)
AEM_JWT_SECRET=1234
```

Notes:

- If chatbot runs **on the host** (not Docker), use `http://localhost:3002/mcp`.
- If aem-mcp listens on another port, update `AEM_MCP_URL` accordingly.
- Keep `JOURNALER_API_BASE_URL` pointed at aem-backend for non-MCP flows.

### 2. Restart chatbot

Restart the API / Docker stack so settings reload. Confirm logs on first Pro/Premium stream:

```text
[TOOLS] Added N AEM MCP tools (url=http://host.docker.internal:3002/mcp, company_id=...)
```

If MCP fails to load tools, chatbot **falls back to legacy AEM REST tools** and logs a warning/error.

### 3. Session JWT + company scope

Required for live customer data:

1. Frontend / client sends the Journaler **session JWT** into chatbot chat/stream (`token` query param / session init — DEV-3914).
2. Prefer also passing **`activeCompanyId`** (DEV-3916). Chatbot re-signs the JWT with `companyId` using `AEM_JWT_SECRET` so aem-mcp → aem-backend stays company-scoped.
3. Without JWT: MCP is skipped / legacy path; tools that need auth will not work correctly.

### 4. Tier gating

| Tier | Behavior |
|------|----------|
| **Pro / Premium** (+ AI Analytics access) | MCP tools registered when `AEM_MCP_ENABLED=true` |
| **Free** | No personal-data MCP tools; upgrade path instead |

---

## Part 3 — End-to-end local checklist

Run in order:

1. [ ] **aem-backend** up on `:3000` (DB migrated, user exists)
2. [ ] **aem-mcp** up on `:3002` with `AEM_BACKEND_URL=http://localhost:3000/api` and matching `JWT_SECRET`
3. [ ] `GET /health` on aem-mcp OK
4. [ ] Session token works against `POST /mcp` `tools/list`
5. [ ] **chatbot** has `AEM_MCP_ENABLED=true` and `AEM_MCP_URL` pointing at aem-mcp
6. [ ] Stream a Pro/Premium chat with `token=<jwt>` (and company id if needed)
7. [ ] Log line shows MCP tools loaded
8. [ ] Ask a read question, e.g. “How many wallets do I have?” / “Give me a quick account overview”

Scenario pack: `chatbot/docs/MCP_USER_HISTORY_SCENARIOS.md`  
Playground: `chatbot/playgrounds/mcp-chat-prompt-tester.html` (if present)

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401` from `/mcp` | Bad/expired JWT or secret mismatch | Regenerate token; align `JWT_SECRET` / `AEM_JWT_SECRET` |
| Chatbot falls back to legacy tools | aem-mcp down, wrong URL, or empty tool list | Check `AEM_MCP_URL`, `/health`, Docker `host.docker.internal` |
| “MCP enabled but jwt_token missing” | Stream/session without `token` | Pass session JWT into chat init/stream |
| Wrong company data | Missing `companyId` in JWT | Set `activeCompanyId` + `AEM_JWT_SECRET` |
| Port conflict on `3000` | aem-backend and aem-mcp both default to 3000 | Run aem-mcp on `3002` (or another free port) |
| Free user gets no data tools | Expected | Use Pro/Premium test account |
| Tool refused / empty filters | Guardrails (e.g. `list_transactions` needs dates/wallets) | Follow agent prompt + catalog `required_filters` |

---

## Cursor / IDE MCP (optional, DEV-3921)

Product path for customers is **Streamable HTTP** (`POST /mcp`). Stdio MCP for Cursor is optional Phase 4.

For local Cursor testing you can still hit the HTTP endpoint with a Bearer token (same as curl above), or add a custom MCP server entry that proxies to aem-mcp if/when a stdio wrapper is added.

---

## Related docs

- `aem-mcp/README.md` — quick start
- `aem-mcp/catalog/aem-agent-system-prompt.md` — agent discipline
- `aem-mcp/catalog/aem-tool-metadata.yaml` — tools + journeys
- `chatbot/docs/MCP_USER_HISTORY_SCENARIOS.md` — read-only eval scenarios
- `chatbot/.cursor/skills/aem-chatbot-dev/SKILL.md` — chatbot developer guide
