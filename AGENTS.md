# TrustClaw project router

This repository inherits its engineering lifecycle from `D:\AGENTS.md`. This
file contains only TrustClaw-specific constraints.

## Architecture

- Keep runtime-neutral contracts in `packages/contracts`.
- Keep deterministic authorization rules in `packages/policy-engine`.
- Keep orchestration, approval enforcement, tool dispatch, and audit storage in
  `packages/gateway`.
- Keep demos and human interaction in `packages/cli`.
- Use interfaces at persistence, telemetry, approval, and runtime-integration
  boundaries.

## Trust boundaries

- Pass sensitive raw arguments only to the tool handler. Never place them in
  approval context, policy reasons, logs, or audit events.
- Construct canonical request content internally and explicitly before hashing.
  Never rely on ordinary `JSON.stringify` insertion order for security-relevant
  digests.
- Snapshot and validate the authorization request before the first asynchronous
  adapter boundary, and do not expose the execution snapshot to mutable policy
  adapters.
- Authorization decisions must be deterministic and explainable; never use a
  model or probabilistic classifier.
- Security-sensitive thresholds must be configured explicitly unless a
  documented observation justifies a default value.
- Add positive and negative controls for authorization, approval, and audit
  verification behavior.

## Milestone 1 non-goals

- Production readiness or immutable-storage claims
- PostgreSQL, Docker, OpenTelemetry exporters, Jaeger, or Tempo
- OPA, blockchain, or distributed-ledger technology
- Real Gmail or OpenClaw dependencies
- Authentication, multi-tenancy, or a web dashboard
