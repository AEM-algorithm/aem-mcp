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

```bash
cp .env.example .env
npm install
npm run dev
```

Default port: `3002`.

## Tool catalog

Tool definitions and metadata live in `catalog/aem-tool-metadata.yaml` (DEV-3912).

## Related tickets

- DEV-3911 — epic
- DEV-3912 — tool catalog v1
- DEV-3913 — MCP server Phase 0
