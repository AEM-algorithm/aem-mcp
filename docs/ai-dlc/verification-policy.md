# Verification Policy

Populate the repository-specific mapping during setup. Every class must identify mandatory suites and the stage that runs them.

| Ticket class | Build | Lint/type | Unit | Integration | Contract | E2E | Security | Coverage | Review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Docs/config | Required as applicable | Required | — | — | — | — | Secret scan | — | Low/Standard |
| Frontend | Required | Required | Required | As applicable | As applicable | Required for user flow | Required | Required | Standard |
| Backend/API | Required | Required | Required | Required | Required for API changes | As applicable | Required | Required | Standard |
| Payment/auth | Required | Required | Required | Required | Required | Required | Required | Required | High |
| Migration | Required | Required | Required | Required | Schema validation | As applicable | Required | Required | High |

A missing or failed required suite blocks progression. Agents may not downgrade the mapping during Processing.
