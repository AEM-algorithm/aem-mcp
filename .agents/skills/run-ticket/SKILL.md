---
name: run-ticket
description: Execute an approved AI DLC ticket through the repository workflow from Todo to an evidence-bearing pull request. Use only for tickets that passed Definition of Ready and task-tier classification.
disable-model-invocation: true
argument-hint: "<ticket-or-spec-path>"
---

# Run an AI DLC Ticket

1. Read `.ai-dlc/config.json`, the approved spec, task taxonomy, verification policy, and applicable architecture context.
2. Refuse to start if Definition of Ready, task tier, required commands, sandbox, owner, or escalation route is missing.
3. Record the active task in `.ai-dlc/current-task.json` with approved scope, tier, spec version, required checks, start time, retry limit, and status `processing`.
4. Create an isolated branch/workspace and checkpoint the approved plan.
5. Write or update behavioral tests first; observe the expected failure before implementation when feasible.
6. Implement only the approved scope. Run required local verification and iterate on implementation failures.
7. Never weaken tests or cross protected boundaries. Stop and create a structured escalation when a limit or scope change is reached.
8. Set current-task status to `green` only when every required local check has recorded evidence.
9. Open the initial PR with outcome, assertions, commands/results, risk tier, affected systems, assumptions, security notes, and rollback.
10. CI and the configured review tier determine progression to Testing; do not self-approve external gates.
