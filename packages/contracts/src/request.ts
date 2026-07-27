import type { AuthorizationRequest, JsonObject } from "./schemas.js";
import { sha256Digest } from "./canonical.js";

export interface AuthorizationRequestInput {
  requestId: string;
  agentId: string;
  action: string;
  requestedAt: string;
  rawArguments: JsonObject;
  approvalContext: JsonObject;
  canonicalContent: JsonObject;
}

export function createAuthorizationRequest(
  input: AuthorizationRequestInput,
): AuthorizationRequest {
  const canonicalContent: JsonObject = {
    schemaVersion: "1.0",
    requestId: input.requestId,
    agentId: input.agentId,
    action: input.action,
    requestedAt: input.requestedAt,
    rawArgumentsDigest: sha256Digest(input.rawArguments),
    parameters: input.canonicalContent,
  };

  return {
    schemaVersion: "1.0",
    requestId: input.requestId,
    agentId: input.agentId,
    action: input.action,
    requestedAt: input.requestedAt,
    rawArguments: input.rawArguments,
    approvalContext: input.approvalContext,
    canonicalContent,
    requestDigest: sha256Digest(canonicalContent),
  };
}
