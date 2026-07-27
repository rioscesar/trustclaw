import { Type, type Static } from "@sinclair/typebox";

export const JsonValueSchema = Type.Recursive((Self) =>
  Type.Union([
    Type.Null(),
    Type.Boolean(),
    Type.Number(),
    Type.String(),
    Type.Array(Self),
    Type.Record(Type.String(), Self),
  ]),
);

const JsonObjectSchema = Type.Record(Type.String(), JsonValueSchema);
const DigestSchema = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
export const RFC3339_TIMESTAMP_PATTERN =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})$";
const TimestampSchema = Type.String({ pattern: RFC3339_TIMESTAMP_PATTERN });

export const AuthorizationRequestSchema = Type.Object(
  {
    schemaVersion: Type.Literal("1.0"),
    requestId: Type.String({ minLength: 1 }),
    agentId: Type.String({ minLength: 1 }),
    action: Type.String({ minLength: 1 }),
    requestedAt: TimestampSchema,
    rawArguments: JsonObjectSchema,
    approvalContext: JsonObjectSchema,
    canonicalContent: JsonObjectSchema,
    requestDigest: DigestSchema,
  },
  { additionalProperties: false },
);

export const RiskSchema = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("critical"),
]);

export const PolicyDecisionSchema = Type.Object(
  {
    policyVersion: Type.String({ minLength: 1 }),
    requestId: Type.String({ minLength: 1 }),
    disposition: Type.Union([
      Type.Literal("allow"),
      Type.Literal("deny"),
      Type.Literal("approval_required"),
    ]),
    risk: RiskSchema,
    requiredApprovals: Type.Integer({ minimum: 0 }),
    reasonCode: Type.String({ minLength: 1 }),
    reason: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const ApprovalRequestSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    requestDigest: DigestSchema,
    requiredApprovals: Type.Integer({ minimum: 1 }),
    context: JsonObjectSchema,
    expiresAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export const ApprovalRecordSchema = Type.Object(
  {
    approvalId: Type.String({ minLength: 1 }),
    requestDigest: DigestSchema,
    approverId: Type.String({ minLength: 1 }),
    decision: Type.Union([Type.Literal("approve"), Type.Literal("reject")]),
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export const ExecutionOutcomeSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    status: Type.Union([Type.Literal("succeeded"), Type.Literal("failed")]),
    completedAt: TimestampSchema,
    summary: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const AuditEventTypeSchema = Type.Union([
  Type.Literal("request"),
  Type.Literal("policy_decision"),
  Type.Literal("approval"),
  Type.Literal("execution"),
  Type.Literal("outcome"),
]);

export const AuditEventSchema = Type.Object(
  {
    schemaVersion: Type.Literal("1.0"),
    eventId: Type.String({ minLength: 1 }),
    eventType: AuditEventTypeSchema,
    timestamp: TimestampSchema,
    requestId: Type.String({ minLength: 1 }),
    metadata: JsonObjectSchema,
    previousDigest: Type.Union([Type.Null(), DigestSchema]),
    digest: DigestSchema,
  },
  { additionalProperties: false },
);

export type JsonValue = Static<typeof JsonValueSchema>;
export type JsonObject = Record<string, JsonValue>;
export type AuthorizationRequest = Static<typeof AuthorizationRequestSchema>;
export type Risk = Static<typeof RiskSchema>;
export type PolicyDecision = Static<typeof PolicyDecisionSchema>;
export type ApprovalRequest = Static<typeof ApprovalRequestSchema>;
export type ApprovalRecord = Static<typeof ApprovalRecordSchema>;
export type ExecutionOutcome = Static<typeof ExecutionOutcomeSchema>;
export type AuditEventType = Static<typeof AuditEventTypeSchema>;
export type AuditEvent = Static<typeof AuditEventSchema>;
