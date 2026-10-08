---
name: run-ticket
description: Execute an approved AI DLC ticket through the repository workflow from Todo to an evidence-bearing pull request. Use only for tickets that passed Definition of Ready and task-tier classification.
disable-model-invocation: true
---

# Run an AI DLC Ticket

1. Read `.ai-dlc/config.json`, the approved spec, task taxonomy, verification policy, and applicable architecture context.
2. Refuse to start if Definition of Ready, task tier, commands, execution boundary, owner, or escalation route is missing.
3. Record `.ai-dlc/current-task.json` with scope, tier, spec version, required checks, limits, and status `processing`.
4. Use an isolated branch/worktree. Checkpoint the approved plan.
5. Write or update behavioral tests first and observe the expected failure when feasible.
6. Implement only approved scope; run required verification and iterate on implementation failures.
7. Never weaken tests or cross protected boundaries. Escalate on limits or scope changes.
8. Set status `green` only when every required local check has evidence.
9. Open the initial PR with outcome, assertions, commands/results, tier, affected systems, assumptions, security notes, and rollback.
10. CI and the review tier determine progression to Testing; do not self-approve external gates.
