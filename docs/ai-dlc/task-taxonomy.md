# Agent Task Taxonomy

Classify during Refinement. Choose the highest applicable tier.

## Low

Bounded, reversible, well-tested, no sensitive data or protected paths, no contract/schema change. May auto-merge after required checks if policy permits.

## Standard

Normal feature or defect work with clear specification and test surface. Requires one outcome reviewer.

## High

Security-sensitive, multi-component, public contract, data-model, payment/authentication, migration, or large-blast-radius work. Requires named specialist/full review.

## Prohibited

Production credential access, destructive/unbounded operations, unresolved product decisions, unreviewed destructive migration, or work without enforceable safety/verification. Cannot enter autonomous execution.

## Decision factors

- Requirement clarity and test maturity.
- Blast radius and reversibility.
- Data sensitivity and credentials.
- Contract, schema, authentication, payment, or migration impact.
- Production/network access.
- Number of components and dependency uncertainty.
