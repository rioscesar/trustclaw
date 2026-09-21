import {
  isAuthorizationRequest,
  type AuthorizationRequest,
  type PolicyDecision,
  type Risk,
} from "@trustclaw/contracts";

import type { PolicyEngine } from "./policy-engine.js";

const EMAIL_SEND_ACTION = "email.send";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EmailPolicyOptions {
  version?: string;
  /**
   * Recipients that may receive email without human approval. Reserved for
   * demo-safe, explicitly allowlisted low-risk addresses.
   */
  allowedLowRiskRecipients?: readonly string[];
  /** Exact recipient addresses that must never receive email. */
  deniedRecipients?: readonly string[];
  /** Recipient domains that must never receive email (e.g. customer-facing domains). */
  deniedDomains?: readonly string[];
}

/**
 * Deterministic policy for the governed `email.send` action. Every
 * disposition is derived only from the recipient address; message subject
 * and body are never inspected here and never leave the tool handler
 * boundary.
 */
export class EmailPolicyEngine implements PolicyEngine {
  readonly version: string;
  private readonly allowedLowRiskRecipients: ReadonlySet<string>;
  private readonly deniedRecipients: ReadonlySet<string>;
  private readonly deniedDomains: ReadonlySet<string>;

  constructor(options: EmailPolicyOptions = {}) {
    this.version = options.version ?? "trustclaw-email-policy-v1";
    this.allowedLowRiskRecipients = new Set(
      (options.allowedLowRiskRecipients ?? []).map(normalizeRecipient),
    );
    this.deniedRecipients = new Set(
      (options.deniedRecipients ?? []).map(normalizeRecipient),
    );
    this.deniedDomains = new Set(
      (options.deniedDomains ?? []).map((domain) =>
        domain.trim().toLowerCase(),
      ),
    );
  }

  evaluate(value: unknown): PolicyDecision {
    if (!isAuthorizationRequest(value)) {
      return this.deny(
        "unknown",
        "MALFORMED_REQUEST",
        "The authorization request is malformed.",
      );
    }

    const request = value;
    if (request.action !== EMAIL_SEND_ACTION) {
      return this.deny(
        request.requestId,
        "UNKNOWN_GOVERNED_ACTION",
        `No policy exists for governed action ${request.action}.`,
      );
    }

    const to = this.stringField(request, "to");
    if (to === undefined || !EMAIL_PATTERN.test(to.trim())) {
      return this.deny(
        request.requestId,
        "MALFORMED_EMAIL_SEND",
        "email.send requires a valid recipient address in policy parameters.",
      );
    }

    const normalized = normalizeRecipient(to);
    const domain = normalized.slice(normalized.lastIndexOf("@") + 1);

    if (
      this.deniedRecipients.has(normalized) ||
      this.deniedDomains.has(domain)
    ) {
      return this.deny(
        request.requestId,
        "FORBIDDEN_RECIPIENT",
        `Recipient ${to} is on the forbidden list for external communication.`,
        "high",
      );
    }

    if (this.allowedLowRiskRecipients.has(normalized)) {
      return {
        policyVersion: this.version,
        requestId: request.requestId,
        disposition: "allow",
        risk: "low",
        requiredApprovals: 0,
        reasonCode: "ALLOWLISTED_LOW_RISK_RECIPIENT",
        reason: `Recipient ${to} is an explicitly allowlisted low-risk recipient.`,
      };
    }

    return {
      policyVersion: this.version,
      requestId: request.requestId,
      disposition: "approval_required",
      risk: "high",
      requiredApprovals: 1,
      reasonCode: "EXTERNAL_COMMUNICATION_REQUIRES_APPROVAL",
      reason: `Sending email to ${to} is an external communication and requires one human approval.`,
    };
  }

  private stringField(
    request: AuthorizationRequest,
    field: string,
  ): string | undefined {
    const parameters = request.canonicalContent.parameters;
    if (
      parameters === null ||
      typeof parameters !== "object" ||
      Array.isArray(parameters)
    ) {
      return undefined;
    }
    const value = parameters[field];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private deny(
    requestId: string,
    reasonCode: string,
    reason: string,
    risk: Risk = "high",
  ): PolicyDecision {
    return {
      policyVersion: this.version,
      requestId,
      disposition: "deny",
      risk,
      requiredApprovals: 0,
      reasonCode,
      reason,
    };
  }
}

function normalizeRecipient(value: string): string {
  return value.trim().toLowerCase();
}
