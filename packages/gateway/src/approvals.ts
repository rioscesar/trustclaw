import { isApprovalRecord, type ApprovalRecord } from "@trustclaw/contracts";

export interface ApprovalValidation {
  valid: boolean;
  reasonCode?: string;
  reason?: string;
}

export function validateApprovals(
  approvals: readonly unknown[],
  requestDigest: string,
  requiredApprovals: number,
  now: Date,
): ApprovalValidation {
  const approvers = new Set<string>();

  for (const value of approvals) {
    if (!isApprovalRecord(value)) {
      return invalid("MALFORMED_APPROVAL", "An approval record is malformed.");
    }
    const approval: ApprovalRecord = value;
    if (approval.requestDigest !== requestDigest) {
      return invalid(
        "APPROVAL_DIGEST_MISMATCH",
        "An approval is bound to a different request digest.",
      );
    }
    if (approval.decision !== "approve") {
      return invalid("APPROVAL_REJECTED", "An approver rejected the request.");
    }
    if (
      Date.parse(approval.expiresAt) <= now.getTime() ||
      Date.parse(approval.expiresAt) <= Date.parse(approval.createdAt)
    ) {
      return invalid("APPROVAL_EXPIRED", "An approval is expired.");
    }
    if (approvers.has(approval.approverId)) {
      return invalid(
        "DUPLICATE_APPROVER",
        "Required approvals must come from distinct approvers.",
      );
    }
    approvers.add(approval.approverId);
  }

  if (approvers.size < requiredApprovals) {
    return invalid(
      "INSUFFICIENT_APPROVALS",
      `Expected ${requiredApprovals} distinct approval(s), received ${approvers.size}.`,
    );
  }

  return { valid: true };
}

function invalid(reasonCode: string, reason: string): ApprovalValidation {
  return { valid: false, reasonCode, reason };
}
