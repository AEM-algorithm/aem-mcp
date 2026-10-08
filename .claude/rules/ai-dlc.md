# AI DLC Project Rules

- Work only from an approved, machine-verifiable specification.
- Confirm task tier and required verification before implementation.
- Use test-first execution for agent-ready feature work.
- Do not weaken, remove, skip, or rewrite a failing test merely to obtain green.
- Stay inside approved scope and protected-path policy.
- Create coherent checkpoints; never checkpoint red tests or mixed concerns.
- Stop at configured retry, runtime, scope, or cost limits and produce the escalation report.
- Open a PR only with acceptance evidence, verification results, risk tier, affected systems, assumptions, and rollback.
- A local green result is not sufficient; CI independently verifies the change.
- Never claim S2 without qualification evidence.
