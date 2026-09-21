// This is the only file in the TrustClaw email adapter that imports the
// OpenClaw plugin SDK. Everything else (policy, gateway, email transport,
// approval UX, and the governed tool logic) is OpenClaw-agnostic and lives
// in workspace-neutral packages.
import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

import { InMemoryAuditStore } from "@trustclaw/gateway";
import { EmailPolicyEngine } from "@trustclaw/policy-engine";
import { createEmailHandler, resolveEmailMode } from "@trustclaw/email-adapter";
import {
  createEmailTerminalApprovalProvider,
  findApprover,
  formatAuthorizedEvidence,
} from "@trustclaw/cli";

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
const sharedAudit = new InMemoryAuditStore();

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
        "Send an email immediately when the user explicitly asks you to send one. " +
        "Call this tool directly — do not draft the email and ask the user for a separate " +
        "confirmation first; the tool's own execution path performs any required policy " +
        "check and human authorization before the message is actually sent.",
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

        if (output.succeeded) {
          // Presentation only: re-renders evidence already produced by this
          // governed run. The digest comes from the completed execution and the
          // verification is a live `verify()` over the same audit chain that
          // recorded it -- nothing here is recomputed or hardcoded.
          const verification = await sharedAudit.verify();
          console.log(
            `\n${formatAuthorizedEvidence({
              agentId,
              action: "send_email",
              policy: output.decision.policyVersion,
              approver: findApprover(sharedAudit, output.requestDigest) ?? "n/a (no approval required)",
              timestamp: output.outcome?.completedAt ?? new Date().toISOString(),
              requestDigest: output.requestDigest,
              auditVerified: verification.valid,
            })}\n`,
          );
        }

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
