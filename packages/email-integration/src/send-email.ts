import { randomUUID } from "node:crypto";

import {
  createAuthorizationRequest,
  sha256Digest,
  type ExecutionOutcome,
  type PolicyDecision,
  type Risk,
} from "@trustclaw/contracts";
import {
  TrustClawGateway,
  type ApprovalProvider,
  type AuditStore,
  type ToolHandler,
} from "@trustclaw/gateway";
import type { PolicyEngine } from "@trustclaw/policy-engine";

export const EMAIL_SEND_ACTION = "email.send";

export interface SendEmailArgs {
  to: string;
  subject: string;
  body: string;
}

export interface GovernedSendEmailDeps {
  policy: PolicyEngine;
  audit: AuditStore;
  toolHandler: ToolHandler;
  agentId: string;
  /**
   * Builds the approval provider for one specific send. Receives the exact
   * arguments the user/agent asked to send so a human-facing approval UI can
   * show full subject/body context; this data is never itself passed
   * through the gateway's audited approval context.
   */
  createApprovalProvider: (args: SendEmailArgs) => ApprovalProvider;
  clock?: () => Date;
  approvalTtlMs?: number;
  requestIdFactory?: () => string;
}

export interface GovernedSendEmailResult {
  /** True once the tool handler ran, regardless of its own success/failure. */
  executed: boolean;
  /** True only when the tool handler ran and reported success. */
  succeeded: boolean;
  risk: Risk;
  requestDigest: string;
  decision: PolicyDecision;
  outcome?: ExecutionOutcome;
  denialReason?: string;
}

/**
 * Governed `send_email` execution path, shared by every runtime adapter
 * (OpenClaw plugin, CLI demo scenarios, tests). Contains no runtime-specific
 * code: it only depends on the runtime-neutral contracts and gateway.
 *
 * Recipient is the only field placed in policy-visible `parameters`.
 * Subject and a body digest (never the body text) are placed in the
 * approval context, which the gateway also copies into the audit trail.
 * The full raw arguments (to/subject/body) are bound into the request
 * digest via `rawArgumentsDigest` and are passed only to the tool handler.
 */
export async function executeGovernedSendEmail(
  args: SendEmailArgs,
  deps: GovernedSendEmailDeps,
): Promise<GovernedSendEmailResult> {
  const clock = deps.clock ?? (() => new Date());
  const requestId = (deps.requestIdFactory ?? randomUUID)();
  const bodyDigest = sha256Digest(args.body);

  const request = createAuthorizationRequest({
    requestId,
    agentId: deps.agentId,
    action: EMAIL_SEND_ACTION,
    requestedAt: clock().toISOString(),
    rawArguments: { to: args.to, subject: args.subject, body: args.body },
    approvalContext: {
      summary: `Send email to ${args.to}`,
      to: args.to,
      subject: args.subject,
      bodyDigest,
      policy: "external-communication",
    },
    parameters: { to: args.to },
  });

  const gateway = new TrustClawGateway({
    policy: deps.policy,
    audit: deps.audit,
    // Constructed lazily so a human-facing approval provider (e.g. a
    // terminal prompt) is never built or invoked when the policy allows the
    // action outright.
    approvalProvider: {
      requestApproval: (approvalRequest) =>
        deps.createApprovalProvider(args).requestApproval(approvalRequest),
    },
    toolHandler: deps.toolHandler,
    ...(deps.clock ? { clock: deps.clock } : {}),
    ...(deps.approvalTtlMs === undefined ? {} : { approvalTtlMs: deps.approvalTtlMs }),
  });

  const result = await gateway.execute(request);
  const succeeded = result.executed && result.outcome?.status === "succeeded";

  return {
    executed: result.executed,
    succeeded,
    risk: result.decision.risk,
    requestDigest: request.requestDigest,
    decision: result.decision,
    ...(result.outcome ? { outcome: result.outcome } : {}),
    ...(result.denialReason === undefined ? {} : { denialReason: result.denialReason }),
  };
}
