import {
  canonicalize,
  isApprovalRecord,
  isAuthorizationRequest,
  isExecutionOutcome,
  isPolicyDecision,
  type ApprovalRecord,
  type ApprovalRequest,
  type AuthorizationRequest,
  type ExecutionOutcome,
  type JsonObject,
  type JsonValue,
  type PolicyDecision,
} from "@trustclaw/contracts";
import type { PolicyEngine } from "@trustclaw/policy-engine";

import type { AuditStore } from "./audit.js";
import { validateApprovals } from "./approvals.js";

function snapshotJson<T>(value: T): T {
  return JSON.parse(canonicalize(value as unknown as JsonValue)) as T;
}

export interface ApprovalProvider {
  requestApproval(
    request: ApprovalRequest,
  ): readonly ApprovalRecord[] | PromiseLike<readonly ApprovalRecord[]>;
}

export interface ToolHandler {
  execute(
    action: string,
    rawArguments: JsonObject,
    requestId: string,
  ): ExecutionOutcome | PromiseLike<ExecutionOutcome>;
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
    if (!isAuthorizationRequest(request)) {
      throw new Error("Authorization request is invalid.");
    }
    const governedRequest = snapshotJson(request);

    await this.record("request", governedRequest.requestId, {
      agentId: governedRequest.agentId,
      action: governedRequest.action,
      approvalContext: governedRequest.approvalContext,
      requestDigest: governedRequest.requestDigest,
    });

    const policyDecision = await this.options.policy.evaluate(
      snapshotJson(governedRequest),
    );
    if (
      !isPolicyDecision(policyDecision) ||
      policyDecision.requestId !== governedRequest.requestId
    ) {
      throw new Error("Policy engine returned an invalid decision.");
    }
    const decision = snapshotJson(policyDecision);
    await this.record("policy_decision", governedRequest.requestId, {
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
      const approvalRequestExpiresAt = new Date(
        now.getTime() + this.approvalTtlMs,
      ).toISOString();
      const approvalRequest: ApprovalRequest = {
        requestId: governedRequest.requestId,
        requestDigest: governedRequest.requestDigest,
        requiredApprovals: decision.requiredApprovals,
        context: governedRequest.approvalContext,
        expiresAt: approvalRequestExpiresAt,
      };
      const approvals = await this.options.approvalProvider.requestApproval(
        snapshotJson(approvalRequest),
      );
      const validation = validateApprovals(
        approvals,
        governedRequest.requestDigest,
        decision.requiredApprovals,
        this.clock(),
        approvalRequestExpiresAt,
      );
      const validApprovalRecords = approvals
        .filter(isApprovalRecord)
        .map((approval) => snapshotJson(approval));

      for (const approval of validApprovalRecords) {
        await this.record("approval", governedRequest.requestId, {
          approvalId: approval.approvalId,
          approverId: approval.approverId,
          decision: approval.decision,
          expiresAt: approval.expiresAt,
          requestDigest: approval.requestDigest,
        });
      }

      if (!validation.valid) {
        if (validApprovalRecords.length === 0) {
          await this.record("approval", governedRequest.requestId, {
            reasonCode: validation.reasonCode ?? "INVALID_APPROVAL",
            status: "invalid",
          });
        }
        return {
          executed: false,
          decision,
          denialReason: `${validation.reasonCode}: ${validation.reason}`,
        };
      }
    }

    await this.record("execution", governedRequest.requestId, {
      action: governedRequest.action,
      status: "started",
    });
    const toolOutcome = await this.options.toolHandler.execute(
      governedRequest.action,
      governedRequest.rawArguments,
      governedRequest.requestId,
    );
    if (
      !isExecutionOutcome(toolOutcome) ||
      toolOutcome.requestId !== governedRequest.requestId
    ) {
      throw new Error("Tool handler returned an invalid execution outcome.");
    }
    const outcome = snapshotJson(toolOutcome);
    await this.record("outcome", governedRequest.requestId, {
      status: outcome.status,
      summary: outcome.summary,
    });

    return { executed: true, decision, outcome };
  }

  private async record(
    eventType:
      "request" | "policy_decision" | "approval" | "execution" | "outcome",
    requestId: string,
    metadata: JsonObject,
  ): Promise<void> {
    await this.options.audit.append({
      eventType,
      timestamp: this.clock().toISOString(),
      requestId,
      metadata,
    });
  }
}
