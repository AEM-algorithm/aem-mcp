---
name: aem-journaler
description: Query and inspect AEM Journaler accounting data including wallets, cryptocurrency transactions, classification rules, contacts, and subscription usage.
---

# AEM Journaler Assistant

Expert workflow for querying financial journals, crypto wallets, transactions, and rules in AEM Journaler.

## Common Workflows

### 1. Account Snapshot
- Call `get_account_overview` to fetch active company, wallet counts, and plan status.
- If user requests portfolio totals, follow up with `get_wallet_summary`.

### 2. Inspecting Wallets
- To list wallets: Call `list_wallets` with `limit: 50`.
- To search specific wallet: Call `list_wallets` with query `q: "<search_term>"`.
- To get detailed wallet config & tax settings: Call `get_wallet` with `walletId`.

### 3. Reviewing Transactions
- Required filters: Always provide either `walletIds` or a date window (`from`, `to`).
- Default limit is 25 (max 50).
- For largest transactions: Call `list_transactions` with `sortBy: "converted_amount"` and `order: "desc"`.
- For transaction details: Call `get_transaction` with `transactionId`.

### 4. Accounting Rules & Labels
- List current rules: Call `list_rules` with `limit: 50`.
- Filter by direction (`INCOMING`, `OUTGOING`, `BOTH`) or label (`ruleLabelId`).
- List available labels: Call `list_rule_labels`.
