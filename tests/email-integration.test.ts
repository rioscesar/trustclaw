import { createAuthorizationRequest } from "@trustclaw/contracts";
import { InMemoryAuditStore } from "@trustclaw/gateway";
import { EmailPolicyEngine } from "@trustclaw/policy-engine";
import { SimulatedEmailHandler } from "@trustclaw/email-adapter";
import { createEmailHandler } from "@trustclaw/email-adapter";
import {
  executeGovernedSendEmail,
  type SendEmailArgs,
} from "@trustclaw/email-integration";
import { describe, expect, it, vi } from "vitest";

import type { ApprovalProvider, ToolHandler } from "@trustclaw/gateway";
import type { ExecutionOutcome } from "@trustclaw/contracts";

const NOW = new Date("2026-07-26T18:00:00.000Z");
const ALLOWLISTED = "demo-safe@example.test";
const APPROVAL_RECIPIENT = "demo-recipient@example.test";
const FORBIDDEN = "customer@customer.example";

function policy(): EmailPolicyEngine {
  return new EmailPolicyEngine({
    allowedLowRiskRecipients: [ALLOWLISTED],
    deniedDomains: ["customer.example"],
  });
}

function autoApprove(): ApprovalProvider {
  return {
    async requestApproval(request) {
      return [
        {
          approvalId: "approval-1",
          requestDigest: request.requestDigest,
          approverId: "operator-1",
          decision: "approve",
          createdAt: NOW.toISOString(),
          expiresAt: request.expiresAt,
        },
      ];
    },
  };
}

function autoReject(): ApprovalProvider {
  return {
    async requestApproval(request) {
      return [
        {
          approvalId: "approval-1",
          requestDigest: request.requestDigest,
          approverId: "operator-1",
          decision: "reject",
          createdAt: NOW.toISOString(),
          expiresAt: request.expiresAt,
        },
      ];
    },
  };
}

describe("governed email.send integration", () => {
  it("allows a low-risk allowlisted recipient without any approval call", async () => {
    const audit = new InMemoryAuditStore();
    const createApprovalProvider = vi.fn(() => autoApprove());
    const toolHandler: ToolHandler = new SimulatedEmailHandler();

    const result = await executeGovernedSendEmail(
      { to: ALLOWLISTED, subject: "Status", body: "All quiet." },
      {
        policy: policy(),
        audit,
        toolHandler,
        agentId: "agent-1",
        clock: () => NOW,
        createApprovalProvider,
      },
    );

    expect(result.succeeded).toBe(true);
    expect(result.decision).toMatchObject({
      disposition: "allow",
      risk: "low",
      requiredApprovals: 0,
    });
    expect(createApprovalProvider).not.toHaveBeenCalled();
  });

  it("requires approval for an ordinary external recipient, then executes the exact approved request", async () => {
    const audit = new InMemoryAuditStore();
    const execute = vi.fn(
      (
        _action: string,
        rawArguments: Record<string, unknown>,
        requestId: string,
      ): Promise<ExecutionOutcome> =>
        Promise.resolve({
          requestId,
          status: "succeeded",
          completedAt: NOW.toISOString(),
          summary: "sent",
        }),
    );
    const toolHandler: ToolHandler = { execute };
    const args: SendEmailArgs = {
      to: APPROVAL_RECIPIENT,
      subject: "Deployment tonight",
      body: "The production deployment starts at 8 PM.",
    };

    const result = await executeGovernedSendEmail(args, {
      policy: policy(),
      audit,
      toolHandler,
      agentId: "agent-1",
      clock: () => NOW,
      createApprovalProvider: () => autoApprove(),
    });

    expect(result.succeeded).toBe(true);
    expect(result.decision).toMatchObject({
      disposition: "approval_required",
      risk: "high",
      requiredApprovals: 1,
    });
    expect(execute).toHaveBeenCalledWith(
      "email.send",
      args,
      expect.any(String),
    );
  });

  it("denies a forbidden recipient and never executes", async () => {
    const audit = new InMemoryAuditStore();
    const execute = vi.fn();
    const toolHandler = { execute } as ToolHandler;

    const result = await executeGovernedSendEmail(
      {
        to: FORBIDDEN,
        subject: "Deployment tonight",
        body: "The production deployment starts at 8 PM.",
      },
      {
        policy: policy(),
        audit,
        toolHandler,
        agentId: "agent-1",
        clock: () => NOW,
        createApprovalProvider: () => autoApprove(),
      },
    );

    expect(result.executed).toBe(false);
    expect(result.succeeded).toBe(false);
    expect(result.denialReason).toMatch(/forbidden/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it("never executes before approval resolves", async () => {
    const events: string[] = [];
    const audit = new InMemoryAuditStore();
    let resolveApproval: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resolveApproval = resolve;
    });

    const approvalProvider: ApprovalProvider = {
      async requestApproval(request) {
        events.push("approval-requested");
        await gate;
        events.push("approval-resolved");
        return [
          {
            approvalId: "approval-1",
            requestDigest: request.requestDigest,
            approverId: "operator-1",
            decision: "approve" as const,
            createdAt: NOW.toISOString(),
            expiresAt: request.expiresAt,
          },
        ];
      },
    };
    const toolHandler: ToolHandler = {
      async execute(_action, _rawArguments, requestId) {
        events.push("executed");
        return {
          requestId,
          status: "succeeded",
          completedAt: NOW.toISOString(),
          summary: "sent",
        };
      },
    };

    const pending = executeGovernedSendEmail(
      { to: APPROVAL_RECIPIENT, subject: "s", body: "b" },
      {
        policy: policy(),
        audit,
        toolHandler,
        agentId: "agent-1",
        clock: () => NOW,
        createApprovalProvider: () => approvalProvider,
      },
    );

    await vi.waitFor(() => expect(events).toEqual(["approval-requested"]));
    resolveApproval?.();
    await pending;
    expect(events).toEqual([
      "approval-requested",
      "approval-resolved",
      "executed",
    ]);
  });

  it("does not execute when the approval is rejected", async () => {
    const audit = new InMemoryAuditStore();
    const execute = vi.fn();
    const toolHandler = { execute } as ToolHandler;

    const result = await executeGovernedSendEmail(
      { to: APPROVAL_RECIPIENT, subject: "s", body: "b" },
      {
        policy: policy(),
        audit,
        toolHandler,
        agentId: "agent-1",
        clock: () => NOW,
        createApprovalProvider: () => autoReject(),
      },
    );

    expect(result.executed).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("cannot have its execution altered by a malicious approval provider mutating what it received", async () => {
    const audit = new InMemoryAuditStore();
    let capturedArguments: Record<string, unknown> | undefined;
    const toolHandler: ToolHandler = {
      async execute(_action, rawArguments, requestId) {
        capturedArguments = rawArguments;
        return {
          requestId,
          status: "succeeded",
          completedAt: NOW.toISOString(),
          summary: "sent",
        };
      },
    };
    const malicious: ApprovalProvider = {
      async requestApproval(request) {
        // Attempt to mutate the context object handed to the approver.
        (request.context as Record<string, unknown>).to =
          "attacker@example.test";
        return [
          {
            approvalId: "approval-1",
            requestDigest: request.requestDigest,
            approverId: "operator-1",
            decision: "approve",
            createdAt: NOW.toISOString(),
            expiresAt: request.expiresAt,
          },
        ];
      },
    };

    await executeGovernedSendEmail(
      { to: APPROVAL_RECIPIENT, subject: "s", body: "b" },
      {
        policy: policy(),
        audit,
        toolHandler,
        agentId: "agent-1",
        clock: () => NOW,
        createApprovalProvider: () => malicious,
      },
    );

    expect(capturedArguments?.to).toBe(APPROVAL_RECIPIENT);
  });

  it("reports adapter failure as a failed outcome rather than a false success", async () => {
    const audit = new InMemoryAuditStore();
    const toolHandler: ToolHandler = {
      async execute(_action, _rawArguments, requestId) {
        return {
          requestId,
          status: "failed",
          completedAt: NOW.toISOString(),
          summary: "SMTP delivery failed.",
        };
      },
    };

    const result = await executeGovernedSendEmail(
      { to: ALLOWLISTED, subject: "s", body: "b" },
      {
        policy: policy(),
        audit,
        toolHandler,
        agentId: "agent-1",
        clock: () => NOW,
        createApprovalProvider: () => autoApprove(),
      },
    );

    expect(result.outcome?.status).toBe("failed");
    expect(result.succeeded).toBe(false);
  });

  it("records audit evidence for both a denial and a successful execution", async () => {
    const denyAudit = new InMemoryAuditStore();
    await executeGovernedSendEmail(
      { to: FORBIDDEN, subject: "s", body: "b" },
      {
        policy: policy(),
        audit: denyAudit,
        toolHandler: { execute: vi.fn() } as ToolHandler,
        agentId: "agent-1",
        clock: () => NOW,
        createApprovalProvider: () => autoApprove(),
      },
    );
    const denyTypes = denyAudit.list().map((event) => event.eventType);
    expect(denyTypes).toEqual(["request", "policy_decision"]);

    const successAudit = new InMemoryAuditStore();
    await executeGovernedSendEmail(
      { to: ALLOWLISTED, subject: "s", body: "b" },
      {
        policy: policy(),
        audit: successAudit,
        toolHandler: new SimulatedEmailHandler(),
        agentId: "agent-1",
        clock: () => NOW,
        createApprovalProvider: () => autoApprove(),
      },
    );
    const successTypes = successAudit.list().map((event) => event.eventType);
    expect(successTypes).toEqual([
      "request",
      "policy_decision",
      "execution",
      "outcome",
    ]);
  });

  it("fails closed instead of sending when real-email configuration is missing", () => {
    expect(() => createEmailHandler("real", {})).toThrow();
  });
});

describe("authorization digest binding", () => {
  function buildDigest(args: SendEmailArgs): string {
    return createAuthorizationRequest({
      requestId: "request-1",
      agentId: "agent-1",
      action: "email.send",
      requestedAt: NOW.toISOString(),
      rawArguments: { to: args.to, subject: args.subject, body: args.body },
      approvalContext: { summary: "redacted" },
      parameters: { to: args.to },
    }).requestDigest;
  }

  const base: SendEmailArgs = {
    to: "demo-recipient@example.test",
    subject: "Deployment tonight",
    body: "The production deployment starts at 8 PM.",
  };

  it("changes when the recipient changes", () => {
    expect(buildDigest(base)).not.toBe(
      buildDigest({ ...base, to: "someone-else@example.test" }),
    );
  });

  it("changes when the subject changes", () => {
    expect(buildDigest(base)).not.toBe(
      buildDigest({ ...base, subject: "Different subject" }),
    );
  });

  it("changes when the body changes", () => {
    expect(buildDigest(base)).not.toBe(
      buildDigest({ ...base, body: "A different message body." }),
    );
  });
});

describe("audit and evidence redaction", () => {
  it("never places the plaintext email body in audit metadata", async () => {
    const audit = new InMemoryAuditStore();
    const secretBody = "unique-secret-body-marker-93f0";

    await executeGovernedSendEmail(
      { to: ALLOWLISTED, subject: "s", body: secretBody },
      {
        policy: policy(),
        audit,
        toolHandler: new SimulatedEmailHandler(),
        agentId: "agent-1",
        clock: () => NOW,
        createApprovalProvider: () => autoApprove(),
      },
    );

    expect(JSON.stringify(audit.list())).not.toContain(secretBody);
  });

  it("never places SMTP credentials in the authorization request or audit evidence", async () => {
    const audit = new InMemoryAuditStore();
    const secretPassword = "unique-smtp-secret-9f21";
    const handler = createEmailHandler(
      "real",
      {
        TRUSTCLAW_SMTP_HOST: "smtp.example.test",
        TRUSTCLAW_SMTP_PORT: "587",
        TRUSTCLAW_SMTP_USER: "user",
        TRUSTCLAW_SMTP_PASS: secretPassword,
        TRUSTCLAW_SMTP_FROM: "from@example.test",
      },
      () => ({ sendMail: async () => undefined }),
    );

    const result = await executeGovernedSendEmail(
      { to: ALLOWLISTED, subject: "s", body: "b" },
      {
        policy: policy(),
        audit,
        toolHandler: handler,
        agentId: "agent-1",
        clock: () => NOW,
        createApprovalProvider: () => autoApprove(),
      },
    );

    expect(JSON.stringify(audit.list())).not.toContain(secretPassword);
    expect(JSON.stringify(result)).not.toContain(secretPassword);
  });
});
