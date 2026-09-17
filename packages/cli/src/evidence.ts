export interface AuthorizedEvidence {
  agentId: string;
  action: string;
  policy: string;
  approver: string;
  timestamp: string;
  requestDigest: string;
  auditVerified: boolean;
}

export interface DeniedEvidence {
  agentId: string;
  action: string;
  policy: string;
  reason: string;
  requestDigest: string;
}

/** No secret values are ever included in these summaries. */
export function formatAuthorizedEvidence(evidence: AuthorizedEvidence): string {
  return [
    "AUTHORIZED / EXECUTED",
    `Agent:              ${evidence.agentId}`,
    `Action:             ${evidence.action}`,
    `Policy:             ${evidence.policy}`,
    `Approver:           ${evidence.approver}`,
    `Timestamp:          ${evidence.timestamp}`,
    `Request digest:     ${evidence.requestDigest}`,
    `Audit verification: ${evidence.auditVerified ? "VERIFIED" : "VERIFICATION FAILED"}`,
  ].join("\n");
}

export function formatDeniedEvidence(evidence: DeniedEvidence): string {
  return [
    "DENIED",
    `Agent:          ${evidence.agentId}`,
    `Action:         ${evidence.action}`,
    `Policy:         ${evidence.policy}`,
    `Reason:         ${evidence.reason}`,
    `Request digest: ${evidence.requestDigest}`,
  ].join("\n");
}
