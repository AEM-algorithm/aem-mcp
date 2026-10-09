# Outcome-Based Review Standard

Review the result against the approved specification and risk tier.

- Does observable behavior meet every test assertion?
- Are tests meaningful, including error and boundary paths?
- Did independent CI run every required check on the reviewed commit?
- Did the change remain inside scope and protected-path policy?
- Are security, data, architecture, and compatibility risks addressed?
- Are assumptions and unresolved issues explicit?
- Is rollback safe and testable?

Style preferences are not correctness failures unless they violate a versioned standard. Escalate architecture/security concerns even when tests are green.
