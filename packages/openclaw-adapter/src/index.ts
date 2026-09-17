// This is the only file in the TrustClaw email adapter that imports the
// OpenClaw plugin SDK. Everything else (policy, gateway, email transport,
// approval UX, and the governed tool logic) is OpenClaw-agnostic and lives
// in workspace-neutral packages.
import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

import { InMemoryAuditStore, type AuditStore } from "@trustclaw/gateway";
import { EmailPolicyEngine } from "@trustclaw/policy-engine";
import { createEmailHandler, resolveEmailMode } from "@trustclaw/email-adapter";
import { createEmailTerminalApprovalProvider } from "@trustclaw/cli";

import { runSendEmailTool } from "./tool-logic.js";

const configSchema = Type.Object(
  {
    agentId: Type.Optional(Type.String({ description: "Identity recorded on every authorization request." })),
    allowedLowRiskRecipients: Type.Optional(
      Type.Array(Type.String(), {
        description: "Recipients that may receive email without human approval.",
      }),
    ),
    deniedRecipients: Type.Optional(
      Type.Array(Type.String(), { description: "Recipient addresses that must never receive email." }),
    ),
    deniedDomains: Type.Optional(
      Type.Array(Type.String(), { description: "Recipient domains that must never receive email." }),
    ),
  },
  { additionalProperties: false },
);

// One audit chain per running Gateway process, shared across every governed
// send in this session so `pnpm demo:tamper`-style verification later sees
// one continuous history.
const sharedAudit: AuditStore = new InMemoryAuditStore();

export default defineToolPlugin({
  id: "trustclaw-email",
  name: "TrustClaw Governed Email",
  description: "Sends email through the TrustClaw authorization gateway: policy, approval, and audit are unavoidable.",
  configSchema,
  tools: (tool) => [
    tool({
      name: "send_email",
      label: "Send Email (TrustClaw governed)",
      description:
        "Send an email. Every call is policy-evaluated, may require human approval, and is recorded in a tamper-evident audit trail before any message leaves the mailbox.",
      parameters: Type.Object({
        to: Type.String({ description: "Recipient email address." }),
        subject: Type.String({ description: "Email subject line." }),
        body: Type.String({ description: "Email body text." }),
      }),
      outputSchema: Type.Object(
        {
          executed: Type.Boolean(),
          succeeded: Type.Boolean(),
          risk: Type.String(),
          requestDigest: Type.String(),
          summary: Type.String(),
        },
        { additionalProperties: false },
      ),
      async execute({ to, subject, body }, config, context) {
        context.signal?.throwIfAborted();

        const agentId = config.agentId ?? "openclaw-demo";
        const policy = new EmailPolicyEngine({
          ...(config.allowedLowRiskRecipients ? { allowedLowRiskRecipients: config.allowedLowRiskRecipients } : {}),
          ...(config.deniedRecipients ? { deniedRecipients: config.deniedRecipients } : {}),
          ...(config.deniedDomains ? { deniedDomains: config.deniedDomains } : {}),
        });
        // Fails closed: throws if real mode is selected without complete,
        // valid SMTP configuration. Never silently falls back to simulated.
        const toolHandler = createEmailHandler(resolveEmailMode(process.env), process.env);

        const output = await runSendEmailTool(
          { to, subject, body },
          {
            policy,
            audit: sharedAudit,
            toolHandler,
            agentId,
            createApprovalProvider: (emailArgs) =>
              createEmailTerminalApprovalProvider({
                agentId,
                action: "send_email",
                to: emailArgs.to,
                subject: emailArgs.subject,
                body: emailArgs.body,
              }),
          },
        );

        return {
          executed: output.executed,
          succeeded: output.succeeded,
          risk: output.risk,
          requestDigest: output.requestDigest,
          summary: output.summary,
        };
      },
    }),
  ],
});
