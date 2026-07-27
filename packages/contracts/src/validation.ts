import { Value } from "@sinclair/typebox/value";

import {
  ApprovalRequestSchema,
  ApprovalRecordSchema,
  AuditEventSchema,
  AuthorizationRequestSchema,
  ExecutionOutcomeSchema,
  PolicyDecisionSchema,
  type ApprovalRequest,
  type ApprovalRecord,
  type AuditEvent,
  type AuthorizationRequest,
  type ExecutionOutcome,
  type PolicyDecision,
} from "./schemas.js";
import { sha256Digest } from "./canonical.js";

export function isValidTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function isAuthorizationRequest(
  value: unknown,
): value is AuthorizationRequest {
  if (
    !Value.Check(AuthorizationRequestSchema, value) ||
    !isValidTimestamp(value.requestedAt)
  ) {
    return false;
  }

  const canonical = value.canonicalContent;
  return (
    canonical.schemaVersion === value.schemaVersion &&
    canonical.requestId === value.requestId &&
    canonical.agentId === value.agentId &&
    canonical.action === value.action &&
    canonical.requestedAt === value.requestedAt &&
    canonical.rawArgumentsDigest === sha256Digest(value.rawArguments) &&
    sha256Digest(canonical) === value.requestDigest &&
    canonical.parameters !== null &&
    typeof canonical.parameters === "object" &&
    !Array.isArray(canonical.parameters)
  );
}

export function isApprovalRecord(value: unknown): value is ApprovalRecord {
  return (
    Value.Check(ApprovalRecordSchema, value) &&
    isValidTimestamp(value.createdAt) &&
    isValidTimestamp(value.expiresAt)
  );
}

export function isPolicyDecision(value: unknown): value is PolicyDecision {
  return Value.Check(PolicyDecisionSchema, value);
}

export function isApprovalRequest(value: unknown): value is ApprovalRequest {
  return (
    Value.Check(ApprovalRequestSchema, value) &&
    isValidTimestamp(value.expiresAt)
  );
}

export function isExecutionOutcome(value: unknown): value is ExecutionOutcome {
  return (
    Value.Check(ExecutionOutcomeSchema, value) &&
    isValidTimestamp(value.completedAt)
  );
}

export function isAuditEvent(value: unknown): value is AuditEvent {
  return (
    Value.Check(AuditEventSchema, value) && isValidTimestamp(value.timestamp)
  );
}
