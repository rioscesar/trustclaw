import type { PolicyDecision } from "@trustclaw/contracts";

export interface PolicyEngine {
  evaluate(request: unknown): PolicyDecision | PromiseLike<PolicyDecision>;
}
