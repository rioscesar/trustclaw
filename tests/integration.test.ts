import {
  createAuthorizationRequest,
  type ApprovalRecord,
  type ApprovalRequest,
  type AuthorizationRequest,
  type ExecutionOutcome,
  type PolicyDecision,
} from "@trustclaw/contracts";
import {
  InMemoryAuditStore,
  TrustClawGateway,
  type AuditStore,
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
      parameters: {
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
      parameters: {
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

  it("executes the exact raw arguments snapshotted before approval", async () => {
    const now = new Date("2026-07-26T18:00:00.000Z");
    const request = createAuthorizationRequest({
      requestId: "request-mutation",
      agentId: "agent-1",
      action: "gmail.delete_email",
      requestedAt: now.toISOString(),
      rawArguments: { emailCount: 3 },
      approvalContext: { summary: "delete three old emails" },
      parameters: {
        emailCount: 3,
        olderThanDays: 365,
      },
    });
    const execute = vi.fn(
      (
        _action: string,
        _rawArguments: Record<string, unknown>,
        requestId: string,
      ): ExecutionOutcome => ({
        requestId,
        status: "succeeded",
        completedAt: now.toISOString(),
        summary: "Simulated deletion succeeded.",
      }),
    );
    const gateway = new TrustClawGateway({
      policy: new DemoPolicyEngine({ bulkDeleteThreshold: 100 }),
      audit: new InMemoryAuditStore(),
      approvalProvider: {
        requestApproval: (approvalRequest) => {
          request.rawArguments.emailCount = 999;
          return Promise.resolve([
            {
              approvalId: "approval-mutation",
              requestDigest: approvalRequest.requestDigest,
              approverId: "operator-1",
              decision: "approve",
              createdAt: now.toISOString(),
              expiresAt: approvalRequest.expiresAt,
            },
          ]);
        },
      },
      toolHandler: { execute },
      clock: () => now,
    });

    await gateway.execute(request);

    expect(request.rawArguments.emailCount).toBe(999);
    expect(execute).toHaveBeenCalledWith(
      "gmail.delete_email",
      { emailCount: 3 },
      "request-mutation",
    );
  });

  it("denies malformed approval records without throwing or executing", async () => {
    const now = new Date("2026-07-26T18:00:00.000Z");
    const audit = new InMemoryAuditStore();
    const execute = vi.fn();
    const request = createAuthorizationRequest({
      requestId: "request-malformed-approval",
      agentId: "agent-1",
      action: "gmail.delete_email",
      requestedAt: now.toISOString(),
      rawArguments: { emailCount: 1 },
      approvalContext: { summary: "delete one old email" },
      parameters: {
        emailCount: 1,
        olderThanDays: 365,
      },
    });
    const gateway = new TrustClawGateway({
      policy: new DemoPolicyEngine({ bulkDeleteThreshold: 100 }),
      audit,
      approvalProvider: {
        requestApproval: () =>
          Promise.resolve([
            { decision: "approve" } as unknown as ApprovalRecord,
          ]),
      },
      toolHandler: {
        execute,
      } as ToolHandler,
      clock: () => now,
    });

    const result = await gateway.execute(request);

    expect(result).toMatchObject({
      executed: false,
      denialReason: expect.stringContaining("MALFORMED_APPROVAL"),
    });
    expect(execute).not.toHaveBeenCalled();
    expect(audit.verify()).toMatchObject({ valid: true });
  });

  it("supports mixed synchronous and asynchronous adapters", async () => {
    const now = new Date("2026-07-26T18:00:00.000Z");
    const backingAudit = new InMemoryAuditStore();
    const audit: AuditStore = {
      append: (input) => Promise.resolve(backingAudit.append(input)),
      list: () => Promise.resolve(backingAudit.list()),
      verify: () => Promise.resolve(backingAudit.verify()),
    };
    const demoPolicy = new DemoPolicyEngine({ bulkDeleteThreshold: 100 });
    const request = createAuthorizationRequest({
      requestId: "request-mixed-adapters",
      agentId: "agent-1",
      action: "gmail.delete_email",
      requestedAt: now.toISOString(),
      rawArguments: { emailCount: 1 },
      approvalContext: { summary: "delete one old email" },
      parameters: {
        emailCount: 1,
        olderThanDays: 365,
      },
    });
    const gateway = new TrustClawGateway({
      policy: {
        evaluate: (value) => Promise.resolve(demoPolicy.evaluate(value)),
      },
      audit,
      approvalProvider: {
        requestApproval: (approvalRequest) => [
          {
            approvalId: "approval-mixed-adapters",
            requestDigest: approvalRequest.requestDigest,
            approverId: "operator-1",
            decision: "approve",
            createdAt: now.toISOString(),
            expiresAt: approvalRequest.expiresAt,
          },
        ],
      },
      toolHandler: {
        execute: (_action, _arguments, requestId) => ({
          requestId,
          status: "succeeded",
          completedAt: now.toISOString(),
          summary: "Synchronous simulated execution succeeded.",
        }),
      },
      clock: () => now,
    });

    const result = await gateway.execute(request);

    expect(result.executed).toBe(true);
    await expect(Promise.resolve(audit.verify())).resolves.toEqual({
      valid: true,
      eventCount: 5,
    });
  });

  it("isolates execution from policy-adapter mutation", async () => {
    const now = new Date("2026-07-26T18:00:00.000Z");
    const request = createAuthorizationRequest({
      requestId: "request-policy-mutation",
      agentId: "agent-1",
      action: "gmail.delete_email",
      requestedAt: now.toISOString(),
      rawArguments: { emailCount: 3 },
      approvalContext: { summary: "delete three old emails" },
      parameters: {
        emailCount: 3,
        olderThanDays: 365,
      },
    });
    const execute = vi.fn(
      (
        _action: string,
        _arguments: Record<string, unknown>,
        requestId: string,
      ): ExecutionOutcome => ({
        requestId,
        status: "succeeded",
        completedAt: now.toISOString(),
        summary: "Simulated execution succeeded.",
      }),
    );
    const demoPolicy = new DemoPolicyEngine({ bulkDeleteThreshold: 100 });
    const gateway = new TrustClawGateway({
      policy: {
        evaluate: (value) => {
          const decision = demoPolicy.evaluate(value) as PolicyDecision;
          (value as AuthorizationRequest).rawArguments.emailCount = 999;
          return decision;
        },
      },
      audit: new InMemoryAuditStore(),
      approvalProvider: {
        requestApproval: (approvalRequest) => [
          {
            approvalId: "approval-policy-mutation",
            requestDigest: approvalRequest.requestDigest,
            approverId: "operator-1",
            decision: "approve",
            createdAt: now.toISOString(),
            expiresAt: approvalRequest.expiresAt,
          },
        ],
      },
      toolHandler: { execute },
      clock: () => now,
    });

    await gateway.execute(request);

    expect(execute).toHaveBeenCalledWith(
      "gmail.delete_email",
      { emailCount: 3 },
      "request-policy-mutation",
    );
  });

  it("isolates enforcement from mutation of a returned policy decision", async () => {
    const now = new Date("2026-07-26T18:00:00.000Z");
    const backingAudit = new InMemoryAuditStore();
    let returnedDecision: PolicyDecision | undefined;
    const audit: AuditStore = {
      append: (input) => {
        if (input.eventType === "policy_decision" && returnedDecision) {
          returnedDecision.disposition = "allow";
          returnedDecision.requiredApprovals = 0;
        }
        return backingAudit.append(input);
      },
      list: () => backingAudit.list(),
      verify: () => backingAudit.verify(),
    };
    const approvalProvider = vi.fn((approvalRequest: ApprovalRequest) => [
      {
        approvalId: "approval-decision-mutation",
        requestDigest: approvalRequest.requestDigest,
        approverId: "operator-1",
        decision: "approve" as const,
        createdAt: now.toISOString(),
        expiresAt: approvalRequest.expiresAt,
      },
    ]);
    const demoPolicy = new DemoPolicyEngine({ bulkDeleteThreshold: 100 });
    const request = createAuthorizationRequest({
      requestId: "request-decision-mutation",
      agentId: "agent-1",
      action: "gmail.delete_email",
      requestedAt: now.toISOString(),
      rawArguments: { emailCount: 3 },
      approvalContext: { summary: "delete three old emails" },
      parameters: {
        emailCount: 3,
        olderThanDays: 365,
      },
    });
    const gateway = new TrustClawGateway({
      policy: {
        evaluate: (value) => {
          returnedDecision = demoPolicy.evaluate(value) as PolicyDecision;
          return returnedDecision;
        },
      },
      audit,
      approvalProvider: { requestApproval: approvalProvider },
      toolHandler: {
        execute: (_action, _arguments, requestId) => ({
          requestId,
          status: "succeeded",
          completedAt: now.toISOString(),
          summary: "Simulated execution succeeded.",
        }),
      },
      clock: () => now,
    });

    const result = await gateway.execute(request);

    expect(result.executed).toBe(true);
    expect(result.decision).toMatchObject({
      disposition: "approval_required",
      requiredApprovals: 1,
    });
    expect(approvalProvider).toHaveBeenCalledOnce();
  });

  it("prevents an approval provider from extending the request deadline", async () => {
    const now = new Date("2026-07-26T18:00:00.000Z");
    const execute = vi.fn();
    const request = createAuthorizationRequest({
      requestId: "request-expiry-mutation",
      agentId: "agent-1",
      action: "gmail.delete_email",
      requestedAt: now.toISOString(),
      rawArguments: { emailCount: 1 },
      approvalContext: { summary: "delete one old email" },
      parameters: {
        emailCount: 1,
        olderThanDays: 365,
      },
    });
    const gateway = new TrustClawGateway({
      policy: new DemoPolicyEngine({ bulkDeleteThreshold: 100 }),
      audit: new InMemoryAuditStore(),
      approvalProvider: {
        requestApproval: (approvalRequest) => {
          approvalRequest.expiresAt = "2026-07-26T18:10:00.000Z";
          return [
            {
              approvalId: "approval-expiry-mutation",
              requestDigest: approvalRequest.requestDigest,
              approverId: "operator-1",
              decision: "approve",
              createdAt: now.toISOString(),
              expiresAt: approvalRequest.expiresAt,
            },
          ];
        },
      },
      toolHandler: { execute } as ToolHandler,
      clock: () => now,
    });

    const result = await gateway.execute(request);

    expect(result).toMatchObject({
      executed: false,
      denialReason: expect.stringContaining("APPROVAL_EXPIRY_EXCEEDS_REQUEST"),
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
