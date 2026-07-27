import type { ApprovalRecord } from "@trustclaw/contracts";
import { validateApprovals } from "@trustclaw/gateway";
import { describe, expect, it } from "vitest";

const now = new Date("2026-07-26T18:00:00.000Z");

function approval(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    approvalId: "approval-1",
    requestDigest: `sha256:${"a".repeat(64)}`,
    approverId: "operator-1",
    decision: "approve",
    createdAt: "2026-07-26T17:59:00.000Z",
    expiresAt: "2026-07-26T18:05:00.000Z",
    ...overrides,
  };
}

describe("approval enforcement", () => {
  it("rejects expired approvals", () => {
    expect(
      validateApprovals(
        [approval({ expiresAt: "2026-07-26T17:59:30.000Z" })],
        approval().requestDigest,
        1,
        now,
      ),
    ).toMatchObject({ valid: false, reasonCode: "APPROVAL_EXPIRED" });
  });

  it("rejects approvals bound to another request", () => {
    expect(
      validateApprovals([approval()], `sha256:${"b".repeat(64)}`, 1, now),
    ).toMatchObject({ valid: false, reasonCode: "APPROVAL_DIGEST_MISMATCH" });
  });

  it("requires two distinct approvers", () => {
    expect(
      validateApprovals(
        [approval(), approval({ approvalId: "approval-2" })],
        approval().requestDigest,
        2,
        now,
      ),
    ).toMatchObject({ valid: false, reasonCode: "DUPLICATE_APPROVER" });

    expect(
      validateApprovals(
        [
          approval(),
          approval({ approvalId: "approval-2", approverId: "operator-2" }),
        ],
        approval().requestDigest,
        2,
        now,
      ),
    ).toEqual({ valid: true });
  });

  it("rejects execution authorization with too few approvals", () => {
    expect(
      validateApprovals([approval()], approval().requestDigest, 2, now),
    ).toMatchObject({ valid: false, reasonCode: "INSUFFICIENT_APPROVALS" });
  });

  it("rejects malformed approval records", () => {
    expect(
      validateApprovals(
        [{ decision: "approve" }],
        approval().requestDigest,
        1,
        now,
      ),
    ).toMatchObject({ valid: false, reasonCode: "MALFORMED_APPROVAL" });
  });
});
