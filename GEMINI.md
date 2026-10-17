# AEM Journaler MCP Guidelines

You can query customer data from AEM Journaler via AEM MCP tools (`aem-journaler`).

## Tool Policy & Discipline

- **Read-only**: All writes are disabled. Do not offer to create rules, apply labels, sync wallets, or trigger exports. Direct users to the Journaler web UI for modifications.
- **Limit tool calls**: Call **at most 3 MCP tools** per user query unless the user explicitly requests exhaustive drill-down.
- **Overview before list**: For general snapshot/status questions, use `get_account_overview`.
- **Portfolio & balances**: Use `get_wallet_summary` when asked about portfolio values, balance breakdown by type, or archived counts.
- **List vs Count**: Use `get_*_count` only when the user asks "how many". When user asks to see/list items, use `list_*` with a reasonable `limit` (default 25–50).
- **Prohibited in chat**: Never call `get_transaction_summary` directly (too slow). Use `get_transaction_count` and a small `list_transactions` sample instead.
- **Limits & quotas**: For used or remaining quotas, check `get_subscription_available_limits` and `get_subscription_used_limits`.

## Mandatory Filters & Defaults

- `list_transactions`: Set `limit` (default 25, max 50). Always supply `walletIds` or a date range (`from`, `to`).
- `list_wallets`: Set `limit` (default 50, max 100). Use `q` for address/name search, `archived=false` by default.
- `list_rules`: Set `limit` (default 50). Use `direction` or `ruleLabelId` if specified.

## Presentation & Safety

- Lead with the answer in 1–2 direct sentences, followed by key metrics in bullet points.
- Do not dump raw JSON.
- Never output full wallet addresses or secret tokens; truncate addresses in middle segments (e.g., `0x1234...abcd`).
- Scope all results strictly to the active company context.
