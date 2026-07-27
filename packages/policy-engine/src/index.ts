import {
  isAuthorizationRequest,
  type AuthorizationRequest,
  type PolicyDecision,
} from "@trustclaw/contracts";

export interface PolicyEngine {
  evaluate(request: unknown): PolicyDecision | PromiseLike<PolicyDecision>;
}

export interface DemoPolicyOptions {
  version?: string;
  bulkDeleteThreshold: number;
}

export class DemoPolicyEngine implements PolicyEngine {
  readonly version: string;
  readonly bulkDeleteThreshold: number;

  constructor(options: DemoPolicyOptions) {
    if (
      !Number.isInteger(options.bulkDeleteThreshold) ||
      options.bulkDeleteThreshold < 1
    ) {
      throw new TypeError(
        "bulkDeleteThreshold must be configured as a positive integer.",
      );
    }
    this.version = options.version ?? "trustclaw-demo-v1";
    this.bulkDeleteThreshold = options.bulkDeleteThreshold;
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
    if (request.action !== "gmail.delete_email") {
      return this.deny(
        request.requestId,
        "UNKNOWN_GOVERNED_ACTION",
        `No policy exists for governed action ${request.action}.`,
      );
    }

    const olderThanDays = this.numberField(request, "olderThanDays");
    const emailCount = this.numberField(request, "emailCount");
    if (
      olderThanDays === undefined ||
      emailCount === undefined ||
      olderThanDays < 0 ||
      !Number.isInteger(emailCount) ||
      emailCount < 1
    ) {
      return this.deny(
        request.requestId,
        "MALFORMED_GMAIL_DELETE",
        "Gmail deletion requires non-negative olderThanDays and a positive integer emailCount.",
      );
    }

    if (emailCount > this.bulkDeleteThreshold) {
      return {
        policyVersion: this.version,
        requestId: request.requestId,
        disposition: "approval_required",
        risk: "critical",
        requiredApprovals: 2,
        reasonCode: "BULK_DELETE_THRESHOLD_EXCEEDED",
        reason: `Deleting ${emailCount} emails exceeds the threshold of ${this.bulkDeleteThreshold}.`,
      };
    }

    if (olderThanDays >= 365) {
      return {
        policyVersion: this.version,
        requestId: request.requestId,
        disposition: "approval_required",
        risk: "medium",
        requiredApprovals: 1,
        reasonCode: "AGED_EMAIL_DELETE",
        reason:
          "Deleting email at least one year old requires one human approval.",
      };
    }

    return this.deny(
      request.requestId,
      "RECENT_EMAIL_DELETE_DENIED",
      "The demo policy denies deletion of email newer than one year.",
    );
  }

  private numberField(
    request: AuthorizationRequest,
    field: string,
  ): number | undefined {
    const parameters = request.canonicalContent.parameters;
    if (
      parameters === null ||
      typeof parameters !== "object" ||
      Array.isArray(parameters)
    ) {
      return undefined;
    }
    const value = parameters[field];
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  }

  private deny(
    requestId: string,
    reasonCode: string,
    reason: string,
  ): PolicyDecision {
    return {
      policyVersion: this.version,
      requestId,
      disposition: "deny",
      risk: "high",
      requiredApprovals: 0,
      reasonCode,
      reason,
    };
  }
}
