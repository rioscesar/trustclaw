import {
  createAuthorizationRequest,
  type ApprovalRequest,
  type ExecutionOutcome,
} from "@trustclaw/contracts";
import {
  InMemoryAuditStore,
  TrustClawGateway,
  type ApprovalProvider,
  type ToolHandler,
} from "@trustclaw/gateway";
import { DemoPolicyEngine } from "@trustclaw/policy-engine";
import { describe, expect, it, vi } from "vitest";

describe("end-to-end vertical slice", () => {
  it("approves, executes, and audits simulated email deletion without leaking raw arguments", async () => {
    const now = new Date("2026-07-26T18:00:00.000Z");
    const audit = new InMemoryAuditStore();
    const approvalProvider: ApprovalProvider = {
      requestApproval: (request: ApprovalRequest) =>
        Promise.resolve([
          {
            approvalId: "approval-1",
            requestDigest: request.requestDigest,
            approverId: "operator-1",
            decision: "approve",
            createdAt: now.toISOString(),
            expiresAt: request.expiresAt,
          },
        ]),
    };
    const execute = vi.fn(
      (
        _action: string,
        _rawArguments: Record<string, unknown>,
        requestId: string,
      ): Promise<ExecutionOutcome> =>
        Promise.resolve({
          requestId,
          status: "succeeded",
          completedAt: now.toISOString(),
          summary: "Simulated deletion succeeded.",
        }),
    );
    const toolHandler = { execute } as ToolHandler;
    const gateway = new TrustClawGateway({
      policy: new DemoPolicyEngine({ bulkDeleteThreshold: 100 }),
      audit,
      approvalProvider,
      toolHandler,
      clock: () => now,
    });
    const request = createAuthorizationRequest({
      requestId: "request-1",
      agentId: "agent-1",
      action: "gmail.delete_email",
      requestedAt: now.toISOString(),
      rawArguments: { credential: "must-not-leak", emailCount: 3 },
      approvalContext: { summary: "delete 3 old emails" },
      canonicalContent: {
        action: "gmail.delete_email",
        emailCount: 3,
        olderThanDays: 365,
      },
    });

    const result = await gateway.execute(request);

    expect(result.executed).toBe(true);
    expect(result.decision).toMatchObject({
      risk: "medium",
      requiredApprovals: 1,
    });
    expect(execute).toHaveBeenCalledWith(
      "gmail.delete_email",
      request.rawArguments,
      "request-1",
    );
    expect(audit.list().map((event) => event.eventType)).toEqual([
      "request",
      "policy_decision",
      "approval",
      "execution",
      "outcome",
    ]);
    expect(JSON.stringify(audit.list())).not.toContain("must-not-leak");
    expect(audit.verify()).toEqual({ valid: true, eventCount: 5 });
  });

  it("fails closed when a tool handler returns a malformed outcome", async () => {
    const now = new Date("2026-07-26T18:00:00.000Z");
    const request = createAuthorizationRequest({
      requestId: "request-invalid-outcome",
      agentId: "agent-1",
      action: "gmail.delete_email",
      requestedAt: now.toISOString(),
      rawArguments: { emailCount: 1 },
      approvalContext: { summary: "delete one old email" },
      canonicalContent: {
        action: "gmail.delete_email",
        emailCount: 1,
        olderThanDays: 365,
      },
    });
    const gateway = new TrustClawGateway({
      policy: new DemoPolicyEngine({ bulkDeleteThreshold: 100 }),
      audit: new InMemoryAuditStore(),
      approvalProvider: {
        requestApproval: (approvalRequest) =>
          Promise.resolve([
            {
              approvalId: "approval-1",
              requestDigest: approvalRequest.requestDigest,
              approverId: "operator-1",
              decision: "approve",
              createdAt: now.toISOString(),
              expiresAt: approvalRequest.expiresAt,
            },
          ]),
      },
      toolHandler: {
        execute: () =>
          Promise.resolve({
            requestId: request.requestId,
            status: "unknown",
            completedAt: now.toISOString(),
            summary: "Malformed outcome.",
          } as unknown as ExecutionOutcome),
      },
      clock: () => now,
    });

    await expect(gateway.execute(request)).rejects.toThrow(
      "Tool handler returned an invalid execution outcome.",
    );
  });
});
