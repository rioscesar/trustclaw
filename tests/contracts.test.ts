import {
  canonicalize,
  createAuthorizationRequest,
  isApprovalRequest,
  isAuditEvent,
  isExecutionOutcome,
  isPolicyDecision,
  sha256Digest,
} from "@trustclaw/contracts";
import { describe, expect, it } from "vitest";

describe("canonical JSON", () => {
  it("sorts object keys recursively", () => {
    const left = { z: 1, nested: { b: true, a: null }, a: ["x", 2] };
    const right = { a: ["x", 2], nested: { a: null, b: true }, z: 1 };

    expect(canonicalize(left)).toBe(canonicalize(right));
    expect(canonicalize(left)).toBe(
      '{"a":["x",2],"nested":{"a":null,"b":true},"z":1}',
    );
  });

  it("produces stable request digests independent of property insertion order", () => {
    const first = createAuthorizationRequest({
      requestId: "request-1",
      agentId: "agent-1",
      action: "gmail.delete_email",
      requestedAt: "2026-07-26T18:00:00.000Z",
      rawArguments: { folder: "archive", mailboxAccessHandle: "handle-one" },
      approvalContext: { summary: "delete old email" },
      canonicalContent: { olderThanDays: 365, emailCount: 2 },
    });
    const second = createAuthorizationRequest({
      requestId: "request-1",
      agentId: "agent-1",
      action: "gmail.delete_email",
      requestedAt: "2026-07-26T18:00:00.000Z",
      rawArguments: { mailboxAccessHandle: "handle-one", folder: "archive" },
      approvalContext: { summary: "delete old email" },
      canonicalContent: { emailCount: 2, olderThanDays: 365 },
    });

    expect(first.requestDigest).toBe(second.requestDigest);
    expect(first.requestDigest).toBe(sha256Digest(first.canonicalContent));
  });

  it("changes the request digest when sensitive raw arguments change", () => {
    const base = {
      requestId: "request-1",
      agentId: "agent-1",
      action: "gmail.delete_email",
      requestedAt: "2026-07-26T18:00:00.000Z",
      approvalContext: { summary: "delete old email" },
      canonicalContent: { emailCount: 2, olderThanDays: 365 },
    };

    const first = createAuthorizationRequest({
      ...base,
      rawArguments: { mailboxAccessHandle: "handle-one" },
    });
    const second = createAuthorizationRequest({
      ...base,
      rawArguments: { mailboxAccessHandle: "handle-two" },
    });

    expect(first.requestDigest).not.toBe(second.requestDigest);
    expect(JSON.stringify(first.canonicalContent)).not.toContain(
      "mailboxAccessHandle",
    );
    expect(JSON.stringify(first.canonicalContent)).not.toContain("handle-one");
  });
});

describe("runtime contract validation", () => {
  it("accepts valid externally exchanged contracts", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(
      isPolicyDecision({
        policyVersion: "v1",
        requestId: "request-1",
        disposition: "approval_required",
        risk: "medium",
        requiredApprovals: 1,
        reasonCode: "REVIEW_REQUIRED",
        reason: "Human review is required.",
      }),
    ).toBe(true);
    expect(
      isApprovalRequest({
        requestId: "request-1",
        requestDigest: digest,
        requiredApprovals: 1,
        context: { summary: "redacted" },
        expiresAt: "2026-07-26T18:05:00.000Z",
      }),
    ).toBe(true);
    expect(
      isExecutionOutcome({
        requestId: "request-1",
        status: "succeeded",
        completedAt: "2026-07-26T18:00:00.000Z",
        summary: "Simulated execution succeeded.",
      }),
    ).toBe(true);
    expect(
      isAuditEvent({
        schemaVersion: "1.0",
        eventId: "event-1",
        eventType: "request",
        timestamp: "2026-07-26T18:00:00.000Z",
        requestId: "request-1",
        metadata: {},
        previousDigest: null,
        digest,
      }),
    ).toBe(true);
  });

  it("rejects malformed externally exchanged contracts", () => {
    expect(isPolicyDecision({ disposition: "allow" })).toBe(false);
    expect(
      isApprovalRequest({
        requestId: "request-1",
        expiresAt: "not-a-timestamp",
      }),
    ).toBe(false);
    expect(
      isExecutionOutcome({
        requestId: "request-1",
        status: "maybe",
      }),
    ).toBe(false);
    expect(
      isAuditEvent({
        schemaVersion: "1.0",
        timestamp: "not-a-timestamp",
      }),
    ).toBe(false);
  });
});
