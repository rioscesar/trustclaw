import type {
  ExecutionOutcome,
  PolicyDecision,
  Risk,
} from "@trustclaw/contracts";
import type {
  ApprovalProvider,
  AuditStore,
  ToolHandler,
} from "@trustclaw/gateway";
import type { PolicyEngine } from "@trustclaw/policy-engine";

import {
  executeGovernedSendEmail,
  type SendEmailArgs,
} from "@trustclaw/email-integration";

export type { SendEmailArgs };

export interface SendEmailToolDeps {
  policy: PolicyEngine;
  audit: AuditStore;
  toolHandler: ToolHandler;
  agentId: string;
  createApprovalProvider: (args: SendEmailArgs) => ApprovalProvider;
  clock?: () => Date;
  approvalTtlMs?: number;
}

export interface SendEmailToolOutput {
  executed: boolean;
  succeeded: boolean;
  risk: Risk;
  requestDigest: string;
  decision: PolicyDecision;
  outcome?: ExecutionOutcome;
  denialReason?: string;
  summary: string;
}

/**
 * OpenClaw-agnostic implementation of the governed `send_email` tool. This
 * module has no dependency on the `openclaw` package so it can be built and
 * tested without an OpenClaw host installed; `index.ts` is the only file in
 * this package that touches the OpenClaw plugin SDK.
 */
export async function runSendEmailTool(
  args: SendEmailArgs,
  deps: SendEmailToolDeps,
): Promise<SendEmailToolOutput> {
  const result = await executeGovernedSendEmail(args, {
    policy: deps.policy,
    audit: deps.audit,
    toolHandler: deps.toolHandler,
    agentId: deps.agentId,
    createApprovalProvider: deps.createApprovalProvider,
    ...(deps.clock ? { clock: deps.clock } : {}),
    ...(deps.approvalTtlMs === undefined
      ? {}
      : { approvalTtlMs: deps.approvalTtlMs }),
  });

  const summary = result.succeeded
    ? (result.outcome?.summary ?? "Executed.")
    : (result.denialReason ?? result.decision.reason);

  return {
    executed: result.executed,
    succeeded: result.succeeded,
    risk: result.risk,
    requestDigest: result.requestDigest,
    decision: result.decision,
    ...(result.outcome ? { outcome: result.outcome } : {}),
    ...(result.denialReason === undefined
      ? {}
      : { denialReason: result.denialReason }),
    summary,
  };
}
