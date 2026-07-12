# Architecture

## Design goals

- Intercept every governed tool call before execution.
- Make policy decisions deterministic and explainable.
- Preserve a single trace across request, decision, approval, execution, and outcome.
- Attribute actions to an agent, owner, policy version, and approver.
- Detect later modification of audit history without introducing a blockchain.
- Keep the core contracts independent of OpenClaw even though OpenClaw is the first adapter.

## Components

### OpenClaw adapter

A TypeScript ESM plugin that translates OpenClaw tool-call context into TrustClaw's runtime-neutral authorization request. It must fail closed for actions configured as governed when the gateway cannot be reached.

### TrustClaw gateway

The orchestration boundary for policy evaluation, approvals, tool dispatch, telemetry, and audit persistence. The initial implementation should be a small Node.js service rather than a broad platform.

### Policy and risk engine

Versioned deterministic rules map an action and its context to one of four risk levels:

| Risk | Default disposition |
| --- | --- |
| Low | Execute automatically |
| Medium | Require one approval |
| High | Require one explicit approval with stronger context |
| Critical | Require two distinct approvals |

No model decides whether its own action is allowed. An OPA integration can be evaluated after the local rules establish the policy contract.

### Approval workflow

The first workflow may be CLI-based. Approval records bind the approver, decision, request digest, timestamp, and expiry so approval cannot be replayed for a different request.

### Audit store

PostgreSQL stores append-only audit events. Each event includes the previous event digest and its own digest, producing a tamper-evident chain. This is not a blockchain and does not claim immutability against an administrator who can rewrite the database and all external anchors.

### Observability

OpenTelemetry spans represent the agent request, policy decision, approval wait, tool execution, and outcome. Audit event identifiers correlate traces with durable records. Sensitive tool arguments must be redacted before export.

## Initial trust boundary

TrustClaw governs only tool calls routed through its OpenClaw adapter. Direct tool access outside that path is out of scope for the first demo and must not be described as governed.

## Proposed repository shape

```text
trustclaw/
├── packages/
│   ├── contracts/
│   ├── gateway/
│   └── openclaw-adapter/
├── config/
├── docs/
└── tests/
```

The monorepo shape is planned, not yet scaffolded; implementation begins only after the audit and policy contracts are reviewed.

