# Hackathon Demo Runbook — TrustClaw × OpenClaw Governed Email

This runbook covers the thinnest OpenClaw integration on top of Milestone 1:
a `send_email` tool that OpenClaw's LLM calls normally, which TrustClaw
intercepts as an unavoidable execution boundary (policy → optional human
approval → execution → tamper-evident audit).

TrustClaw's own contracts, gateway, policy engine, and audit implementation
are unmodified. Everything OpenClaw-specific lives in
`packages/openclaw-adapter`.

---

## 1. Prerequisites

- Node.js >= 24 (see `engines` in `package.json`).
- `pnpm` (via `corepack prepare pnpm@11.9.0 --activate` if not already
  installed). If `pnpm` is not on `PATH` after that, invoke it as
  `corepack pnpm ...` for every command below.
- A local OpenClaw installation/runtime capable of loading a tool plugin
  (see openclaw.ai docs). Not required for the simulated-mode smoke test in
  this repo — only required to demo the full "LLM decides to call the tool"
  path.
- A **dedicated, disposable demo mailbox** if you intend to run real-mode
  email. Do not use a personal or production mailbox. Any standard SMTP
  submission endpoint that supports STARTTLS/TLS works.
- Two demo recipient addresses you control or have permission to send test
  mail to (one "allowed" and one "approval-required" target). Never put
  real addresses in this repo or its docs — supply them only via your local,
  gitignored `.env`.

## 2. OpenClaw setup

1. Install/point OpenClaw at this repository's `packages/openclaw-adapter`
   as a tool plugin (per OpenClaw's plugin-loading conventions — the
   manifest is `packages/openclaw-adapter/openclaw.plugin.json`, the entry
   point is `packages/openclaw-adapter/src/index.ts`, built via its own
   `tsconfig.json`).
2. In the OpenClaw agent profile used for the demo, configure the plugin
   with (values shown are the demo defaults; override recipients to match
   whatever you actually control):
   ```json
   {
     "agentId": "openclaw-demo",
     "allowedLowRiskRecipients": ["<your allowlisted demo recipient>"],
     "deniedRecipients": [],
     "deniedDomains": ["<a domain you want to demonstrate as forbidden>"]
   }
   ```
   (See `config/email-policy.example.json` for the same shape — that file
   is a template to copy values from, not something TrustClaw code reads
   automatically.)
3. **Important:** if your OpenClaw installation ships its own built-in
   email-sending tool/capability, disable or unregister it for the demo
   agent profile. TrustClaw's plugin does not — and cannot — intercept a
   different tool that bypasses it. This is a demo-environment
   configuration step, not a TrustClaw or OpenClaw code change.
4. Do not add any other email-capable tool to the demo agent. The governed
   `send_email` tool must be the only path to sending mail.

## 3. TrustClaw plugin setup

From the repo root:

```powershell
corepack prepare pnpm@11.9.0 --activate
corepack pnpm install
corepack pnpm build
```

This builds `contracts`, `policy-engine`, `gateway`, `email-adapter`,
`email-integration`, and `cli`. `packages/openclaw-adapter` is intentionally
excluded from the root TypeScript project graph and root test run (it's the
only package that imports the real `openclaw` SDK); build it on its own
when you want to validate it standalone:

```powershell
corepack pnpm --filter @trustclaw/openclaw-adapter exec tsc -p tsconfig.json --noEmit
```

## 4. Environment variables

Copy `.env.example` to `.env` (already gitignored) and fill in only what you
need. Never commit `.env` or put real values in any tracked file.

| Variable | Purpose |
|---|---|
| `TRUSTCLAW_EMAIL_MODE` | `simulated` (default, no network) or `real` (sends via SMTP). |
| `TRUSTCLAW_SMTP_HOST` | SMTP host. Required only when mode is `real`. |
| `TRUSTCLAW_SMTP_PORT` | SMTP port (`587` typical for STARTTLS). |
| `TRUSTCLAW_SMTP_SECURE` | `true` for implicit TLS (port 465), else `false`. |
| `TRUSTCLAW_SMTP_USER` | SMTP auth username for the disposable demo mailbox. |
| `TRUSTCLAW_SMTP_PASS` | SMTP auth password/app-password. Never printed or audited. |
| `TRUSTCLAW_SMTP_FROM` | From address for outgoing demo mail. |

If `TRUSTCLAW_EMAIL_MODE=real` and any required SMTP variable is missing or
invalid, the adapter **fails closed**: it throws before any tool executes
rather than silently falling back to simulated mode.

## 5. Simulated-mode smoke test

No external dependencies, no `.env` required. Run all three deterministic
scenarios:

```powershell
corepack pnpm demo:email:allow
corepack pnpm demo:email:approve
corepack pnpm demo:email:deny
```

Expected: `allow` executes with no approval prompt; `approve` shows the
terminal interception box and auto-approves for a deterministic
non-interactive run; `deny` never calls the email adapter. See §8 for exact
expected output shapes. For the real y/N prompt experience instead of
auto-approval:

```powershell
corepack pnpm demo:email:approve:interactive
```

Run the full automated test suite (unit + integration boundary tests, all
using fake/simulated adapters — no real email is ever sent by tests):

```powershell
corepack pnpm test
```

## 6. Real-email smoke test

1. Set in `.env`: `TRUSTCLAW_EMAIL_MODE=real` plus all `TRUSTCLAW_SMTP_*`
   variables for your disposable demo mailbox.
2. Load the env vars into your shell, then run the interactive approve
   scenario against the real adapter path by driving it through the
   OpenClaw plugin (§2) rather than the CLI scenario runner — the CLI
   scenarios (`demo:email:*`) always use the simulated adapter by design,
   so they stay dependency-free. To validate the SMTP path directly before
   the full OpenClaw run, send yourself (or another address you control) a
   one-off test message through your OpenClaw demo agent's `send_email`
   tool and confirm it arrives.
3. Confirm no credentials or plaintext body ever print to the terminal or
   appear in audit output — only the interception box (recipient/subject/
   body, shown to the human approver only) and the evidence summary are
   printed.

## 7. Exact demo sequence

1. **Low-risk / allow.** Prompt OpenClaw: *"Send a quick status ping to
   `<allowlisted demo recipient>` saying everything is quiet."* OpenClaw
   calls `send_email`; TrustClaw executes immediately, no approval. Show
   the `AUTHORIZED / EXECUTED` evidence.
2. **Consequential / approval required.** Prompt OpenClaw: *"Send
   `<approval-required demo recipient>` an email saying the production
   deployment starts at 8 PM."* TrustClaw intercepts with the boxed UI,
   shows the exact recipient/subject/body and the request digest. Approve
   with `y`. Show that the email actually sends (simulated or real) and the
   `AUTHORIZED / EXECUTED` evidence, including the same request digest.
3. **Forbidden / deny.** Prompt OpenClaw: *"Send `customer@<forbidden
   domain>` an email about tonight's deployment."* TrustClaw denies before
   any adapter call. Show the `DENIED` evidence — no message sent.
4. **Tamper demonstration.** Run `corepack pnpm demo:tamper` to show a
   valid audit history verifying, then a tampered copy of the same history
   failing verification.

## 8. Expected outputs

Allow / execute:

```
AUTHORIZED / EXECUTED
Agent:              openclaw-demo
Action:             send_email
Policy:             trustclaw-email-policy-v1
Approver:           n/a (no approval required)
Timestamp:          <ISO timestamp>
Request digest:     sha256:<hex>
Audit verification: VERIFIED
```

Approval required:

```
----------------------------------------
 TRUSTCLAW // ACTION INTERCEPTED
----------------------------------------

Agent:       openclaw-demo
Action:      send_email
Target:      <recipient>
Subject:     Deployment tonight
Risk:        HIGH
Policy:      external-communication

Decision:
HUMAN APPROVAL REQUIRED

Body:
The production deployment starts at 8 PM.

Request:
sha256:<hex>

----------------------------------------
```

...followed by the same `AUTHORIZED / EXECUTED` block once approved, with
`Approver: demo-operator` (or the real approver id) and the identical
request digest.

Deny:

```
DENIED
Agent:          openclaw-demo
Action:         send_email
Policy:         trustclaw-email-policy-v1
Reason:         Recipient <address> is on the forbidden list for external communication.
Request digest: sha256:<hex>
```

Tamper demo:

```
Valid before tampering: true
Valid after tampering: false
Verifier reason: Current event digest does not match its contents.
```

## 9. Fallback procedure

If the network, SMTP provider, or venue Wi-Fi fails during the live demo:

1. Set (or leave) `TRUSTCLAW_EMAIL_MODE=simulated` — this requires no
   external dependency and is the default.
2. Re-run the same three OpenClaw prompts from §7 unchanged. The governed
   tool, policy, approval UX, and audit evidence are identical in
   simulated mode; only the underlying transport differs. The evidence
   summary output is the same shape either way.
3. If OpenClaw itself is unavailable, fall back further to the CLI
   scenario runner directly (`corepack pnpm demo:email:allow|approve|deny`)
   to show the exact same TrustClaw behavior without depending on the
   OpenClaw runtime at all.

## 10. Reset procedure

Each CLI scenario run (`corepack pnpm demo:email:*`) and each OpenClaw
plugin process starts with a fresh in-memory audit store, so there is no
persisted state to clean up between rehearsals. To fully reset before the
live demo:

1. Restart the OpenClaw process (clears the plugin's in-memory audit chain
   used by `packages/openclaw-adapter`).
2. Confirm `.env` still has the mode/credentials you intend to demo with
   (`simulated` for the safe path, `real` only if you've rehearsed it).
3. Re-run `corepack pnpm test` once before going on stage to confirm the
   boundary is intact end-to-end.
