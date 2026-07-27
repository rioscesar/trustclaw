import {
  isExecutionOutcome,
  isPolicyDecision,
  type ApprovalRecord,
  type ApprovalRequest,
  type AuthorizationRequest,
  type ExecutionOutcome,
  type JsonObject,
  type PolicyDecision,
} from "@trustclaw/contracts";
import type { PolicyEngine } from "@trustclaw/policy-engine";

import type { AuditStore } from "./audit.js";
import { validateApprovals } from "./approvals.js";

export interface ApprovalProvider {
  requestApproval(request: ApprovalRequest): Promise<readonly ApprovalRecord[]>;
}

export interface ToolHandler {
  execute(
    action: string,
    rawArguments: JsonObject,
    requestId: string,
  ): Promise<ExecutionOutcome>;
}

export interface GatewayResult {
  executed: boolean;
  decision: PolicyDecision;
  outcome?: ExecutionOutcome;
  denialReason?: string;
}

export interface GatewayOptions {
  policy: PolicyEngine;
  audit: AuditStore;
  approvalProvider: ApprovalProvider;
  toolHandler: ToolHandler;
  clock?: () => Date;
  approvalTtlMs?: number;
}

export class TrustClawGateway {
  private readonly clock: () => Date;
  private readonly approvalTtlMs: number;

  constructor(private readonly options: GatewayOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.approvalTtlMs = options.approvalTtlMs ?? 5 * 60 * 1000;
  }

  async execute(request: AuthorizationRequest): Promise<GatewayResult> {
    this.record("request", request.requestId, {
      agentId: request.agentId,
      action: request.action,
      approvalContext: request.approvalContext,
      requestDigest: request.requestDigest,
    });

    const decision = this.options.policy.evaluate(request);
    if (
      !isPolicyDecision(decision) ||
      decision.requestId !== request.requestId
    ) {
      throw new Error("Policy engine returned an invalid decision.");
    }
    this.record("policy_decision", request.requestId, {
      disposition: decision.disposition,
      policyVersion: decision.policyVersion,
      reasonCode: decision.reasonCode,
      requiredApprovals: decision.requiredApprovals,
      risk: decision.risk,
    });

    if (decision.disposition === "deny") {
      return { executed: false, decision, denialReason: decision.reason };
    }

    if (decision.requiredApprovals > 0) {
      const now = this.clock();
      const approvalRequest: ApprovalRequest = {
        requestId: request.requestId,
        requestDigest: request.requestDigest,
        requiredApprovals: decision.requiredApprovals,
        context: request.approvalContext,
        expiresAt: new Date(now.getTime() + this.approvalTtlMs).toISOString(),
      };
      const approvals =
        await this.options.approvalProvider.requestApproval(approvalRequest);
      const validation = validateApprovals(
        approvals,
        request.requestDigest,
        decision.requiredApprovals,
        this.clock(),
      );

      for (const approval of approvals) {
        this.record("approval", request.requestId, {
          approvalId: approval.approvalId,
          approverId: approval.approverId,
          decision: approval.decision,
          expiresAt: approval.expiresAt,
          requestDigest: approval.requestDigest,
        });
      }

      if (!validation.valid) {
        return {
          executed: false,
          decision,
          denialReason: `${validation.reasonCode}: ${validation.reason}`,
        };
      }
    }

    this.record("execution", request.requestId, {
      action: request.action,
      status: "started",
    });
    const outcome = await this.options.toolHandler.execute(
      request.action,
      request.rawArguments,
      request.requestId,
    );
    if (
      !isExecutionOutcome(outcome) ||
      outcome.requestId !== request.requestId
    ) {
      throw new Error("Tool handler returned an invalid execution outcome.");
    }
    this.record("outcome", request.requestId, {
      status: outcome.status,
      summary: outcome.summary,
    });

    return { executed: true, decision, outcome };
  }

  private record(
    eventType:
      "request" | "policy_decision" | "approval" | "execution" | "outcome",
    requestId: string,
    metadata: JsonObject,
  ): void {
    this.options.audit.append({
      eventType,
      timestamp: this.clock().toISOString(),
      requestId,
      metadata,
    });
  }
}
