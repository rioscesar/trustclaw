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

1. Install the bundled artifact for this repository's
   `packages/openclaw-adapter` as a tool plugin. The manifest is
   `packages/openclaw-adapter/openclaw.plugin.json`; OpenClaw loads the
   bundled `dist/index.js` from its extension directory, not the TypeScript
   source directly. See §3 for the build/install steps.
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

### Frozen demo-agent configuration

The current demo host uses these intentional, non-secret settings. Preserve
them when recovering the demo; do not paste or commit the full
`~/.openclaw/openclaw.json`, because it may contain credentials or OAuth
material.

```text
agent name                 trustclaw-demo
model                      openai/gpt-5.6-sol
agent runtime              openclaw
tools.profile              full
tools.allow                ["send_email"]
skills                     []
plugins.slots.memory       none
trustclaw-email.agentId    openclaw-demo
trustclaw-email.deniedDomains
                           ["example.com"]
trustclaw-email.allowedLowRiskRecipients
                           []
```

`tools.profile: full` lets the plugin survive the baseline tool filter;
`tools.allow` then reduces the model-visible surface to exactly
`send_email`. Do not change the profile without retaining the explicit
allowlist. `plugins.slots.memory: none` is demo-only and suppresses unrelated
memory-embedding errors.

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
corepack pnpm --filter @trustclaw/openclaw-adapter exec tsc -p tsconfig.json
```

### Bundle and install the OpenClaw plugin

The Gateway executes the installed bundle under
`~/.openclaw/extensions/trustclaw-email/dist/index.js`. After any
`packages/openclaw-adapter` or related runtime-package change, rebuild and
replace that artifact before restarting the Gateway.

The bundle must preserve Node's CommonJS loader for Nodemailer. This is
essential: an ESM bundle without the `createRequire` banner fails at startup
with `Dynamic require of "events" is not supported`.

From a WSL/bash shell with the repository dependencies installed:

```bash
cd <trustclaw-repository>
pnpm --filter @trustclaw/openclaw-adapter exec tsc -p tsconfig.json
pnpm --filter @trustclaw/openclaw-adapter exec esbuild \
  packages/openclaw-adapter/dist/index.js \
  --bundle --platform=node --format=esm --target=node22 --external:openclaw \
  --banner:js='import{createRequire as __tcCR}from"node:module";const require=__tcCR(import.meta.url);' \
  --outfile=/tmp/trustclaw-email/index.js
node --input-type=module -e 'await import("/tmp/trustclaw-email/index.js"); console.log("plugin bundle loads")'
install -d ~/.openclaw/extensions/trustclaw-email/dist
install -m 600 /tmp/trustclaw-email/index.js ~/.openclaw/extensions/trustclaw-email/dist/index.js
```

Keep the existing `openclaw.plugin.json` and minimal installed
`package.json` in the extension directory; the bundle command replaces only
the executable artifact. Restart the Gateway after replacing it. Do not put
credentials in that directory.

## 4. Environment variables

Copy `.env.example` to `.env` (already gitignored) and fill in only what you
need. Never commit `.env` or put real values in any tracked file.

| Variable                   | Purpose                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `TRUSTCLAW_EMAIL_MODE`     | `simulated` (default, no network) or `real` (sends via SMTP).                                                          |
| `TRUSTCLAW_SMTP_HOST`      | SMTP host. Required only when mode is `real`.                                                                          |
| `TRUSTCLAW_SMTP_PORT`      | SMTP port (`587` typical for STARTTLS).                                                                                |
| `TRUSTCLAW_SMTP_SECURE`    | `true` for implicit TLS (port 465), else `false`.                                                                      |
| `TRUSTCLAW_SMTP_USER`      | SMTP auth username for the disposable demo mailbox.                                                                    |
| `TRUSTCLAW_SMTP_PASS`      | SMTP auth password/app-password. Never printed or audited.                                                             |
| `TRUSTCLAW_SMTP_FROM`      | From address for outgoing demo mail.                                                                                   |
| `TRUSTCLAW_DEMO_RECIPIENT` | Recipient used by the CLI approval scenario in real mode. Use only an address you control or have permission to email. |

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

1. Set in `.env`: `TRUSTCLAW_EMAIL_MODE=real`, all
   `TRUSTCLAW_SMTP_*` variables for your disposable demo mailbox, and
   `TRUSTCLAW_DEMO_RECIPIENT` to an address you control or have explicit
   permission to email.
2. Run `corepack pnpm demo:email:approve`. The CLI loads `.env`
   automatically. Real mode always forces the terminal y/N prompt; it
   never uses the simulated scenario's automatic approval. Review the
   exact recipient, subject, body, and request digest before entering `y`.
   Entering anything else denies the action without contacting SMTP.
3. Confirm no credentials or plaintext body ever print to the terminal or
   appear in audit output — only the interception box (recipient/subject/
   body, shown to the human approver only) and the evidence summary are
   printed.

## 7. Exact demo sequence

1. **Consequential / approval required.** Prompt OpenClaw: _"Send
   `<approval-required demo recipient>` an email saying the production
   deployment starts at 8 PM."_ TrustClaw intercepts with the boxed UI,
   shows the exact recipient/subject/body and the request digest. Approve
   with `y`. Show that the email actually sends (simulated or real) and the
   `AUTHORIZED / EXECUTED` evidence, including the same request digest.
2. **Forbidden / deny.** Prompt OpenClaw: _"Send `customer@<forbidden
domain>` an email about tonight's deployment."_ TrustClaw denies before
   any adapter call. The OpenClaw tool result contains the denial reason and
   request digest; no approval prompt or SMTP execution occurs. To show the
   formatted `DENIED` block in the terminal, run
   `corepack pnpm demo:email:deny` separately.
3. **Tamper demonstration.** Run `corepack pnpm demo:tamper` to show a
   valid audit history verifying, then a tampered copy of the same history
   failing verification.

The frozen hackathon configuration has
`allowedLowRiskRecipients: []`, so it deliberately demonstrates approval and
denial only. To show a low-risk allow scenario, configure a separate
recipient you control as allowlisted and remember that real mode sends a real
email to it. Do not use the approval-required recipient for both scenarios.

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

Deny (standalone CLI scenario runner):

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

## 11. Foreground Gateway startup and post-shutdown recovery

The terminal approval provider reads the Gateway process's stdin. Run the
Gateway in a foreground terminal for this demo; a systemd-managed Gateway has
no interactive stdin and cannot receive the `y/N` approval decision.

The foreground Gateway must be the only process on port `18789`. Disable the
user unit before demoing so it cannot reclaim the port after a reboot:

```bash
systemctl --user disable --now openclaw-gateway
```

After a shutdown, open a standalone WSL terminal:

```powershell
wsl -d OpenClawGateway
```

Then run the following in its bash shell. The `tr -d '\r'` is required while
the local `.env` uses CRLF: without it, `TRUSTCLAW_EMAIL_MODE=real` becomes
`real\r` and safely—but misleadingly—selects simulated mode.

```bash
mountpoint -q /mnt/d || sudo mount -t drvfs D: /mnt/d -o metadata
cd <trustclaw-repository>
set -a
. <(tr -d '\r' < .env)
set +a
cd ~
echo "MODE=[$TRUSTCLAW_EMAIL_MODE]"
openclaw gateway --port 18789
```

Confirm all of the following before a real-email demonstration:

- `MODE=[real]`
- `14 plugins` with `trustclaw-email` listed
- Gateway `ready`
- no `trustclaw-email failed to load` error

Drive the demo agent from a second terminal:

```bash
openclaw agent --agent trustclaw-demo --session-key demo-$(date +%s) --message "<ordinary email request>"
```

Do not press Enter in the Gateway terminal before the approval prompt: a
buffered newline is treated as an empty answer and rejects the request. Always
answer or reject a pending approval before stopping the Gateway; otherwise its
readline handle can delay shutdown.
