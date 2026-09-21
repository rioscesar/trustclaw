import { createAuthorizationRequest } from "@trustclaw/contracts";
import { EmailPolicyEngine } from "@trustclaw/policy-engine";
import { describe, expect, it } from "vitest";

function request(to: string, action = "email.send") {
  return createAuthorizationRequest({
    requestId: "request-1",
    agentId: "agent-1",
    action,
    requestedAt: "2026-07-26T18:00:00.000Z",
    rawArguments: { to, subject: "s", body: "b" },
    approvalContext: { summary: "redacted" },
    parameters: { to },
  });
}

describe("email policy", () => {
  const policy = new EmailPolicyEngine({
    allowedLowRiskRecipients: ["demo-safe@example.test"],
    deniedDomains: ["customer.example"],
    deniedRecipients: ["blocked@partner.example"],
  });

  it("allows an explicitly allowlisted low-risk recipient with zero approvals", () => {
    expect(policy.evaluate(request("demo-safe@example.test"))).toMatchObject({
      disposition: "allow",
      risk: "low",
      requiredApprovals: 0,
      reasonCode: "ALLOWLISTED_LOW_RISK_RECIPIENT",
    });
  });

  it("requires one approval for an ordinary external recipient", () => {
    expect(policy.evaluate(request("someone@example.test"))).toMatchObject({
      disposition: "approval_required",
      risk: "high",
      requiredApprovals: 1,
      reasonCode: "EXTERNAL_COMMUNICATION_REQUIRES_APPROVAL",
    });
  });

  it("denies a forbidden recipient domain", () => {
    expect(policy.evaluate(request("customer@customer.example"))).toMatchObject(
      {
        disposition: "deny",
        reasonCode: "FORBIDDEN_RECIPIENT",
      },
    );
  });

  it("denies an individually forbidden recipient", () => {
    expect(policy.evaluate(request("blocked@partner.example"))).toMatchObject({
      disposition: "deny",
      reasonCode: "FORBIDDEN_RECIPIENT",
    });
  });

  it("denies unknown governed actions", () => {
    expect(
      policy.evaluate(request("someone@example.test", "gmail.delete_email")),
    ).toMatchObject({
      disposition: "deny",
      reasonCode: "UNKNOWN_GOVERNED_ACTION",
    });
  });

  it("denies malformed requests", () => {
    expect(policy.evaluate({ action: "email.send" })).toMatchObject({
      disposition: "deny",
      reasonCode: "MALFORMED_REQUEST",
    });
  });

  it("denies a request missing a valid recipient parameter", () => {
    const malformed = createAuthorizationRequest({
      requestId: "request-2",
      agentId: "agent-1",
      action: "email.send",
      requestedAt: "2026-07-26T18:00:00.000Z",
      rawArguments: { to: "not-an-email", subject: "s", body: "b" },
      approvalContext: { summary: "redacted" },
      parameters: { to: "not-an-email" },
    });
    expect(policy.evaluate(malformed)).toMatchObject({
      disposition: "deny",
      reasonCode: "MALFORMED_EMAIL_SEND",
    });
  });

  it("is case- and whitespace-insensitive when matching recipients", () => {
    expect(
      policy.evaluate(request("  Demo-Safe@Example.TEST  ")),
    ).toMatchObject({
      disposition: "allow",
    });
  });
});
