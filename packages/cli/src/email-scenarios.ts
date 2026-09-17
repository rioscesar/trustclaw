import { InMemoryAuditStore } from "@trustclaw/gateway";
import { EmailPolicyEngine } from "@trustclaw/policy-engine";
import { createEmailHandler, resolveEmailMode } from "@trustclaw/email-adapter";
import {
  executeGovernedSendEmail,
  type GovernedSendEmailResult,
  type SendEmailArgs,
} from "@trustclaw/email-integration";

import { createEmailTerminalApprovalProvider } from "./terminal-approval.js";

const FIXED_NOW = new Date("2026-07-26T18:00:00.000Z");
export const DEMO_AGENT_ID = "openclaw-demo";

/** Demo-safe placeholder addresses; never real personal addresses. */
export const LOW_RISK_RECIPIENT = "demo-safe@example.test";
export const APPROVAL_RECIPIENT = "demo-recipient@example.test";
export const FORBIDDEN_DOMAIN = "customer.example";
export const FORBIDDEN_RECIPIENT = `customer@${FORBIDDEN_DOMAIN}`;

export type ScenarioName = "allow" | "approve" | "deny";

export interface ScenarioOutcome {
  name: ScenarioName;
  args: SendEmailArgs;
  result: GovernedSendEmailResult;
  audit: InMemoryAuditStore;
}

const SCENARIO_ARGS: Record<ScenarioName, SendEmailArgs> = {
  allow: {
    to: LOW_RISK_RECIPIENT,
    subject: "Status check",
    body: "This is a low-risk, allowlisted status ping.",
  },
  approve: {
    to: APPROVAL_RECIPIENT,
    subject: "Deployment tonight",
    body: "The production deployment starts at 8 PM.",
  },
  deny: {
    to: FORBIDDEN_RECIPIENT,
    subject: "Deployment tonight",
    body: "The production deployment starts at 8 PM.",
  },
};

function buildPolicy(): EmailPolicyEngine {
  return new EmailPolicyEngine({
    allowedLowRiskRecipients: [LOW_RISK_RECIPIENT],
    deniedDomains: [FORBIDDEN_DOMAIN],
  });
}

export interface RunEmailScenarioOptions {
  /** When true, prompts for a real y/N answer instead of auto-deciding. */
  interactive?: boolean;
}

export async function runEmailScenario(
  name: ScenarioName,
  options: RunEmailScenarioOptions = {},
): Promise<ScenarioOutcome> {
  const audit = new InMemoryAuditStore();
  const mode = resolveEmailMode(process.env);
  const toolHandler = createEmailHandler(mode, process.env);
  const interactiveApproval = options.interactive || mode === "real";
  const args =
    mode === "real" && name === "approve"
      ? {
          ...SCENARIO_ARGS[name],
          to: requireRealDemoRecipient(process.env),
        }
      : SCENARIO_ARGS[name];

  const result = await executeGovernedSendEmail(args, {
    policy: buildPolicy(),
    audit,
    toolHandler,
    agentId: DEMO_AGENT_ID,
    ...(interactiveApproval ? {} : { clock: () => FIXED_NOW }),
    createApprovalProvider: (emailArgs) =>
      createEmailTerminalApprovalProvider(
        {
          agentId: DEMO_AGENT_ID,
          action: "send_email",
          to: emailArgs.to,
          subject: emailArgs.subject,
          body: emailArgs.body,
        },
        {
          risk: "high",
          nonInteractive: !interactiveApproval,
          autoApprove: name === "approve",
          ...(interactiveApproval ? {} : { clock: () => FIXED_NOW }),
        },
      ),
  });

  return { name, args, result, audit };
}

function requireRealDemoRecipient(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const recipient = env.TRUSTCLAW_DEMO_RECIPIENT?.trim();
  if (!recipient) {
    throw new Error(
      "TrustClaw real email demo requires TRUSTCLAW_DEMO_RECIPIENT to be set. Refusing to send real email (fail closed).",
    );
  }
  return recipient;
}

/** Finds the first accepted approver recorded in the audit trail, if any. */
export function findApprover(audit: InMemoryAuditStore): string | undefined {
  for (const event of audit.list()) {
    if (event.eventType === "approval" && event.metadata.decision === "approve") {
      const approverId = event.metadata.approverId;
      if (typeof approverId === "string") {
        return approverId;
      }
    }
  }
  return undefined;
}
