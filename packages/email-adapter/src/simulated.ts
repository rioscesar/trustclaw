import type { ExecutionOutcome, JsonObject } from "@trustclaw/contracts";
import type { ToolHandler } from "@trustclaw/gateway";

export const EMAIL_SEND_ACTION = "email.send";

function requireStringArg(rawArguments: JsonObject, field: string): string {
  const value = rawArguments[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`email.send requires a non-empty "${field}" argument.`);
  }
  return value;
}

/**
 * Fallback tool handler that never contacts a real mail server. Used as the
 * default so the demo works with no external dependencies.
 */
export class SimulatedEmailHandler implements ToolHandler {
  async execute(
    action: string,
    rawArguments: JsonObject,
    requestId: string,
  ): Promise<ExecutionOutcome> {
    if (action !== EMAIL_SEND_ACTION) {
      throw new Error(`No simulated handler for ${action}.`);
    }
    // Validate shape only; never echo recipient/subject/body into audited
    // outcome metadata.
    requireStringArg(rawArguments, "to");
    requireStringArg(rawArguments, "subject");
    requireStringArg(rawArguments, "body");

    return {
      requestId,
      status: "succeeded",
      completedAt: new Date().toISOString(),
      summary:
        "Simulated email dispatch completed; no mail server was contacted.",
    };
  }
}
