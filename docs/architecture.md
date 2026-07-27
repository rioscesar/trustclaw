# Architecture

## Design goals

- Intercept every governed tool call before execution.
- Make policy decisions deterministic and explainable.
- Preserve one correlated lifecycle across request, decision, approval, execution, and outcome.
- Attribute actions to an agent, owner, policy version, and approver.
- Detect later modification of audit history without introducing a blockchain.
- Keep the core contracts independent of OpenClaw even though OpenClaw is the first adapter.

## Components

### Runtime adapter

The milestone's CLI converts a simulated OpenClaw-like tool proposal into TrustClaw's runtime-neutral authorization request. A real OpenClaw adapter is intentionally deferred and must eventually fail closed for configured governed actions when the gateway cannot be reached.

### TrustClaw gateway

The orchestration boundary for policy evaluation, approvals, tool dispatch, telemetry, and audit persistence. The initial implementation is a small Node.js library rather than a network service or broad platform.

### Policy and risk engine

Versioned deterministic rules map an action and its context to one of four risk levels:

| Risk     | Default disposition                                 |
| -------- | --------------------------------------------------- |
| Low      | Execute automatically                               |
| Medium   | Require one approval                                |
| High     | Require one explicit approval with stronger context |
| Critical | Require two distinct approvals                      |

No model decides whether its own action is allowed. An OPA integration can be evaluated after the local rules establish the policy contract.

### Approval workflow

The first workflow may be CLI-based. Approval records bind the approver, decision, request digest, timestamp, and expiry so approval cannot be replayed for a different request.

### Audit store

An append-only in-memory adapter stores audit events. Each event includes the previous event digest and its own digest, producing a tamper-evident chain. Verification detects changed contents, reordering, middle-event removal, and incorrect digests. This is not a blockchain and does not claim immutability. PostgreSQL is a future adapter.

### Observability

The gateway exposes boundaries where telemetry can later represent the agent request, policy decision, approval wait, tool execution, and outcome. No OpenTelemetry exporter is included yet. Sensitive tool arguments must be redacted before any future export.

## Initial trust boundary

TrustClaw governs only calls routed through `TrustClawGateway`. The current Gmail handler is simulated, and direct tool access outside the gateway is out of scope and must not be described as governed.

## Proposed repository shape

```text
trustclaw/
├── packages/
│   ├── contracts/
│   ├── policy-engine/
│   ├── gateway/
│   └── cli/
├── examples/
├── config/
├── docs/
└── tests/
```

The packages communicate through explicit contracts and interfaces. Raw tool arguments reach only the tool handler; policy explanations, approval context, and audit metadata use redacted or canonical fields.
