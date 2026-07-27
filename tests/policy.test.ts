import { createAuthorizationRequest } from "@trustclaw/contracts";
import { DemoPolicyEngine } from "@trustclaw/policy-engine";
import { describe, expect, it } from "vitest";

function request(
  action = "gmail.delete_email",
  olderThanDays = 365,
  emailCount = 3,
) {
  return createAuthorizationRequest({
    requestId: "request-1",
    agentId: "agent-1",
    action,
    requestedAt: "2026-07-26T18:00:00.000Z",
    rawArguments: {},
    approvalContext: { summary: "redacted" },
    parameters: { olderThanDays, emailCount },
  });
}

describe("demo policy", () => {
  const policy = new DemoPolicyEngine({ bulkDeleteThreshold: 100 });

  it("classifies deletion of year-old email as medium risk", () => {
    expect(policy.evaluate(request())).toMatchObject({
      disposition: "approval_required",
      risk: "medium",
      requiredApprovals: 1,
      reasonCode: "AGED_EMAIL_DELETE",
    });
  });

  it("classifies bulk deletion as critical with two approvals", () => {
    expect(
      policy.evaluate(request("gmail.delete_email", 365, 101)),
    ).toMatchObject({
      disposition: "approval_required",
      risk: "critical",
      requiredApprovals: 2,
      reasonCode: "BULK_DELETE_THRESHOLD_EXCEEDED",
    });
  });

  it("denies unknown governed actions", () => {
    expect(policy.evaluate(request("filesystem.delete"))).toMatchObject({
      disposition: "deny",
      reasonCode: "UNKNOWN_GOVERNED_ACTION",
    });
  });

  it("denies malformed requests", () => {
    expect(policy.evaluate({ action: "gmail.delete_email" })).toMatchObject({
      disposition: "deny",
      reasonCode: "MALFORMED_REQUEST",
    });
  });

  it("denies requests whose raw arguments no longer match the digest", () => {
    const tampered = {
      ...request(),
      rawArguments: { mailboxAccessHandle: "substituted-after-approval" },
    };

    expect(policy.evaluate(tampered)).toMatchObject({
      disposition: "deny",
      reasonCode: "MALFORMED_REQUEST",
    });
  });

  it("requires an explicit positive bulk-delete threshold", () => {
    expect(
      () =>
        new DemoPolicyEngine({
          bulkDeleteThreshold: 0,
        }),
    ).toThrow("bulkDeleteThreshold must be configured");
  });
});
