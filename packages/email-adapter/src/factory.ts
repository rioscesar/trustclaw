import type { ToolHandler } from "@trustclaw/gateway";

import { SimulatedEmailHandler } from "./simulated.js";
import { SmtpEmailHandler, type SmtpTransportLike } from "./smtp.js";

export type EmailMode = "simulated" | "real";

/** Reads `TRUSTCLAW_EMAIL_MODE`, defaulting to the safe simulated mode. */
export function resolveEmailMode(
  env: Readonly<Record<string, string | undefined>>,
): EmailMode {
  return env.TRUSTCLAW_EMAIL_MODE === "real" ? "real" : "simulated";
}

/**
 * Builds the tool handler for the governed `email.send` action. Real mode
 * fails closed: missing or malformed SMTP configuration throws rather than
 * silently falling back to the simulated handler.
 */
export function createEmailHandler(
  mode: EmailMode,
  env: Readonly<Record<string, string | undefined>>,
  createTransportFn?: (config: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
  }) => SmtpTransportLike,
): ToolHandler {
  if (mode === "simulated") {
    return new SimulatedEmailHandler();
  }

  if (mode === "real") {
    const host = requireEnv(env, "TRUSTCLAW_SMTP_HOST");
    const portRaw = requireEnv(env, "TRUSTCLAW_SMTP_PORT");
    const user = requireEnv(env, "TRUSTCLAW_SMTP_USER");
    const pass = requireEnv(env, "TRUSTCLAW_SMTP_PASS");
    const from = requireEnv(env, "TRUSTCLAW_SMTP_FROM");
    const port = Number.parseInt(portRaw, 10);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(
        "TRUSTCLAW_SMTP_PORT must be a positive integer. Refusing to send real email (fail closed).",
      );
    }
    const secure = env.TRUSTCLAW_SMTP_SECURE === "true" || port === 465;

    return createTransportFn
      ? new SmtpEmailHandler({ host, port, secure, user, pass, from }, createTransportFn)
      : new SmtpEmailHandler({ host, port, secure, user, pass, from });
  }

  throw new Error(
    `Unknown TrustClaw email mode "${String(mode)}". Use "simulated" or "real".`,
  );
}

function requireEnv(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string {
  const value = env[key];
  if (!value) {
    throw new Error(
      `TrustClaw real email mode requires ${key} to be set. Refusing to send real email (fail closed).`,
    );
  }
  return value;
}
