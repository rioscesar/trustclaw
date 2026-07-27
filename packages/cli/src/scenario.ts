import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";

import {
  createAuthorizationRequest,
  type ApprovalRecord,
  type ApprovalRequest,
  type ExecutionOutcome,
  type JsonObject,
} from "@trustclaw/contracts";
import {
  InMemoryAuditStore,
  TrustClawGateway,
  type ApprovalProvider,
  type ToolHandler,
} from "@trustclaw/gateway";
import { DemoPolicyEngine } from "@trustclaw/policy-engine";

const FIXED_NOW = new Date("2026-07-26T18:00:00.000Z");
const SYNTHETIC_BULK_DELETE_THRESHOLD = 100;

class DemoApprovalProvider implements ApprovalProvider {
  constructor(private readonly nonInteractive: boolean) {}

  async requestApproval(
    request: ApprovalRequest,
  ): Promise<readonly ApprovalRecord[]> {
    let approved = this.nonInteractive;
    if (!this.nonInteractive) {
      const prompt = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = await prompt.question(
        `Approve ${String(request.context.summary)}? [y/N] `,
      );
      prompt.close();
      approved = answer.trim().toLowerCase() === "y";
    }

    return [
      {
        approvalId: randomUUID(),
        requestDigest: request.requestDigest,
        approverId: "demo-operator",
        decision: approved ? "approve" : "reject",
        createdAt: FIXED_NOW.toISOString(),
        expiresAt: request.expiresAt,
      },
    ];
  }
}

class SimulatedGmailHandler implements ToolHandler {
  async execute(
    action: string,
    rawArguments: JsonObject,
    requestId: string,
  ): Promise<ExecutionOutcome> {
    if (action !== "gmail.delete_email") {
      throw new Error(`No simulated handler for ${action}.`);
    }
    const count = rawArguments.emailCount;
    return {
      requestId,
      status: "succeeded",
      completedAt: FIXED_NOW.toISOString(),
      summary: `Simulated deletion of ${String(count)} email(s); Gmail was not contacted.`,
    };
  }
}

export async function runScenario(nonInteractive = true): Promise<{
  audit: InMemoryAuditStore;
  executed: boolean;
  risk: "low" | "medium" | "high" | "critical";
}> {
  const audit = new InMemoryAuditStore();
  const request = createAuthorizationRequest({
    requestId: randomUUID(),
    agentId: "openclaw-demo-agent",
    action: "gmail.delete_email",
    requestedAt: FIXED_NOW.toISOString(),
    rawArguments: {
      mailboxAccessHandle: "synthetic-access-handle",
      emailCount: 3,
      olderThanDays: 365,
    },
    approvalContext: {
      summary: "simulated deletion of 3 emails older than one year",
    },
    parameters: {
      emailCount: 3,
      olderThanDays: 365,
    },
  });
  const gateway = new TrustClawGateway({
    policy: new DemoPolicyEngine({
      bulkDeleteThreshold: SYNTHETIC_BULK_DELETE_THRESHOLD,
    }),
    audit,
    approvalProvider: new DemoApprovalProvider(nonInteractive),
    toolHandler: new SimulatedGmailHandler(),
    clock: () => FIXED_NOW,
  });

  const result = await gateway.execute(request);
  return {
    audit,
    executed: result.executed,
    risk: result.decision.risk,
  };
}
