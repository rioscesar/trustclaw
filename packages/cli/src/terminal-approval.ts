import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";

import type { ApprovalRecord, ApprovalRequest } from "@trustclaw/contracts";
import type { ApprovalProvider } from "@trustclaw/gateway";

export interface EmailApprovalDisplay {
  agentId: string;
  action: string;
  to: string;
  subject: string;
  body: string;
  approverId?: string;
}

const BAR = "-".repeat(40);

function renderBox(
  display: EmailApprovalDisplay,
  request: ApprovalRequest,
  risk: string,
): string {
  return [
    BAR,
    " TRUSTCLAW // ACTION INTERCEPTED",
    BAR,
    "",
    `Agent:       ${display.agentId}`,
    `Action:      ${display.action}`,
    `Target:      ${display.to}`,
    `Subject:     ${display.subject}`,
    `Risk:        ${risk.toUpperCase()}`,
    `Policy:      external-communication`,
    "",
    "Decision:",
    "HUMAN APPROVAL REQUIRED",
    "",
    "Body:",
    display.body,
    "",
    "Request:",
    request.requestDigest,
    "",
    BAR,
  ].join("\n");
}

/**
 * Terminal-based `ApprovalProvider` for the `email.send` demo path. Renders
 * the full recipient/subject/body from a closure over the original tool
 * arguments so a human sees exactly what will execute -- this content is
 * never routed through `ApprovalRequest.context` and therefore never enters
 * the audit trail. The returned approval is bound to the exact
 * `request.requestDigest` supplied by the gateway.
 */
export function createEmailTerminalApprovalProvider(
  display: EmailApprovalDisplay,
  options: {
    risk?: string;
    nonInteractive?: boolean;
    autoApprove?: boolean;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    /** Clock used for the approval's `createdAt`; must match the gateway's clock. */
    clock?: () => Date;
  } = {},
): ApprovalProvider {
  return {
    async requestApproval(
      request: ApprovalRequest,
    ): Promise<readonly ApprovalRecord[]> {
      const risk = options.risk ?? "high";
      console.log(renderBox(display, request, risk));

      let approved: boolean;
      if (options.nonInteractive) {
        approved = options.autoApprove ?? false;
      } else {
        const prompt = createInterface({
          input: options.input ?? process.stdin,
          output: options.output ?? process.stdout,
        });
        const answer = await prompt.question("Approve? [y/N] ");
        prompt.close();
        approved = answer.trim().toLowerCase() === "y";
      }

      const now = options.clock ? options.clock() : new Date();
      return [
        {
          approvalId: randomUUID(),
          requestDigest: request.requestDigest,
          approverId: display.approverId ?? "demo-operator",
          decision: approved ? "approve" : "reject",
          createdAt: now.toISOString(),
          expiresAt: request.expiresAt,
        },
      ];
    },
  };
}
