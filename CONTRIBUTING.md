# Contributing

TrustClaw is in its design phase. Please open an issue before implementing a new subsystem so the change can be checked against the demo scope and trust boundary.

## Principles

- Prefer deterministic, explainable authorization.
- Treat telemetry and audit payloads as potential data-leak paths.
- Back behavior claims with tests or reproducible commands.
- Keep OpenClaw-specific code behind an adapter.
- Avoid dependencies until the use case demonstrates a need.

