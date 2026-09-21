# TrustClaw

Trust, governance, and provenance for autonomous AI systems.

TrustClaw is an experimental trust plane for [OpenClaw](https://openclaw.ai/). It evaluates tool calls before execution, routes risky actions through human approval, and writes a tamper-evident audit history. Milestone 1 includes a runtime-neutral core plus an isolated OpenClaw `send_email` plugin for the local hackathon demo.

## The problem

Agent runtimes are getting better at taking action, but operators still need production-grade answers to a different set of questions:

- Is this agent allowed to perform this action?
- Who approved it?
- Which policy and identity were used?
- What happened, and can an auditor verify the record later?

TrustClaw applies familiar distributed-systems controls—identity, policy, observability, and auditability—to autonomous agents.

## Why now?

Tool-using agents increasingly touch email, files, infrastructure, and business systems. Observability can explain what happened after the fact; TrustClaw's goal is to combine that evidence with enforcement before a consequential action runs.

## Why OpenClaw?

OpenClaw provides the agent runtime and a TypeScript plugin model. TrustClaw is designed as a complementary control plane, beginning with an OpenClaw adapter and keeping its governance contracts runtime-neutral.

## Demo target

The first milestone's OpenClaw demo is a governed email send:

1. A user asks OpenClaw to send an ordinary email.
2. OpenClaw independently selects the governed `send_email` tool.
3. TrustClaw intercepts the exact request, evaluates deterministic policy, and requires approval when appropriate.
4. The exact approved request executes through either a simulated handler or explicitly configured SMTP adapter.
5. The request, decision, approval, execution, and outcome appear in one tamper-evident audit chain.
6. The foreground Gateway prints evidence from the live audit store after a successful execution.

## Architecture

```mermaid
flowchart LR
    User --> OpenClaw
    OpenClaw --> Adapter[TrustClaw OpenClaw adapter]
    Adapter --> Gateway[TrustClaw gateway]
    Gateway --> Policy[Policy and risk engine]
    Policy --> Approval[Human approval]
    Gateway --> Tools
    Gateway --> Audit[(Audit store)]
    Gateway -. future .-> OTel[OpenTelemetry]
```

See [the architecture notes](docs/architecture.md), [the hackathon demo runbook](docs/hackathon-demo-runbook.md), [audit event schema](docs/audit-event.schema.json), and [roadmap](ROADMAP.md).

## Implemented milestone

The first executable vertical slice:

- Converts a simulated `gmail.delete_email` proposal into a runtime-neutral authorization request.
- Snapshots the proposed action before any asynchronous adapter call, canonicalizes it, and binds approvals to its SHA-256 digest and expiration.
- Applies a versioned deterministic policy: year-old email deletion is medium risk; bulk deletion above the configured threshold is critical and requires two distinct approvers.
- Executes only after sufficient valid approval and never contacts Gmail.
- Records request, decision, approval, execution, and outcome events in an in-memory SHA-256 hash chain.
- Verifies valid chains and detects changed, reordered, removed, or incorrectly linked events.
- Exposes an OpenClaw-only `send_email` plugin adapter without coupling the core contracts, policy engine, gateway, or audit store to OpenClaw.
- Uses a terminal approval prompt for the demo and prints `AUTHORIZED / EXECUTED` evidence derived from the completed run's audit store.
- Supports an explicitly selected simulated or SMTP email transport. SMTP configuration comes only from local environment variables and fails closed when incomplete.

The chain is tamper-evident, not immutable. An attacker who can rewrite all in-memory state is outside this milestone's guarantees.

## Setup and demos

Requirements: Node.js 24 and pnpm 11.

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm demo
pnpm demo:tamper
```

`pnpm demo` uses a documented non-interactive approval suitable for CI. Run `pnpm demo:interactive` to answer the approval prompt yourself. Every tool action is simulated.

The bulk-delete threshold has no implicit default and must be configured. The
value in `config/policy.example.json` is synthetic demo data, not a production
recommendation.

## Stack

- Node.js 24 and TypeScript ESM
- pnpm
- OpenClaw governed-email adapter, isolated in `packages/openclaw-adapter`
- TypeBox/JSON Schema for contracts
- Vitest
- ESLint and Prettier

The implementation uses interfaces so PostgreSQL and OpenTelemetry can be added later. They are not dependencies of this milestone.
Policy, approval, tool, and audit adapters may be synchronous or asynchronous;
the gateway awaits either form.

## Status

Milestone 1 is executable and tested, but remains a local demonstration—not a production-ready security boundary.

## License

[Apache License 2.0](LICENSE)
