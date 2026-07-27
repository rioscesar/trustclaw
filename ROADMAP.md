# Roadmap

The goal is a focused demo in roughly eight weeks, not a startup-grade platform.

## Week 1 — Design

- Publish the problem statement, architecture, and audit event contract.
- Define the demo's trust boundary and non-goals.
- Keep the repository free of executable product code.

## Week 2 — Gateway

- [x] Scaffold the pnpm/TypeScript workspace.
- [x] Build a runtime-neutral simulated adapter and gateway interception path.
- [x] Record before-and-after events for every governed tool call.

## Week 3 — OpenTelemetry

- Trace request, policy decision, approval, execution, and outcome.
- Export through OTLP and validate the trace in Jaeger or Grafana Tempo.

## Week 4 — Risk engine

- [x] Add the first versioned deterministic policy rules.
- [x] Cover medium and critical approval dispositions plus denial paths.

## Week 5 — Approval

- [x] Bind approvals to a request digest and expiration.
- [x] Support one- and two-approver enforcement.

## Week 6 — Tamper-evident audit

- [x] Persist append-only events in memory for the first vertical slice.
- [x] Chain events with SHA-256 digests and implement verification.
- Replace the in-memory adapter with PostgreSQL only after the contracts settle.

## Week 7 — Identity

- Attribute every request to an agent and owner.
- Restrict actions by declared capabilities.

## Week 8 — Demo polish

- Add a minimal operational dashboard.
- Record the email-deletion approval demo.
- Document verified limitations and next experiments.

## Explicit non-goals for v1

- Blockchain, tokens, smart contracts, or distributed consensus
- AI-generated authorization decisions
- General-purpose agent framework
- Claims of database immutability
- Production multi-tenancy or enterprise identity federation
