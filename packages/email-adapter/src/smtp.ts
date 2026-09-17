import { createTransport, type Transporter } from "nodemailer";

import type { ExecutionOutcome, JsonObject } from "@trustclaw/contracts";
import type { ToolHandler } from "@trustclaw/gateway";

import { EMAIL_SEND_ACTION } from "./simulated.js";

export interface SmtpEmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

type SendMailFn = (message: {
  from: string;
  to: string;
  subject: string;
  text: string;
}) => Promise<unknown>;

export interface SmtpTransportLike {
  sendMail: SendMailFn;
}

/**
 * Real email transport. Credentials are read once at construction time from
 * caller-supplied configuration (sourced from environment variables) and are
 * never placed in the authorization request, policy reason, approval
 * context, or audit metadata. TLS certificate validation is never weakened.
 */
export class SmtpEmailHandler implements ToolHandler {
  private readonly transport: SmtpTransportLike;
  private readonly from: string;

  constructor(
    config: SmtpEmailConfig,
    createTransportFn: (config: SmtpEmailConfig) => SmtpTransportLike = defaultTransportFactory,
  ) {
    this.transport = createTransportFn(config);
    this.from = config.from;
  }

  async execute(
    action: string,
    rawArguments: JsonObject,
    requestId: string,
  ): Promise<ExecutionOutcome> {
    if (action !== EMAIL_SEND_ACTION) {
      throw new Error(`No SMTP handler for ${action}.`);
    }
    const to = requireString(rawArguments, "to");
    const subject = requireString(rawArguments, "subject");
    const body = requireString(rawArguments, "body");

    try {
      await this.transport.sendMail({ from: this.from, to, subject, text: body });
      return {
        requestId,
        status: "succeeded",
        completedAt: new Date().toISOString(),
        summary: "Email dispatched via SMTP relay.",
      };
    } catch (error) {
      // Never place the raw error (which may echo transport/auth details)
      // into the audited outcome summary.
      return {
        requestId,
        status: "failed",
        completedAt: new Date().toISOString(),
        summary: `SMTP delivery failed (${classifyError(error)}).`,
      };
    }
  }
}

function defaultTransportFactory(config: SmtpEmailConfig): Transporter {
  return createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    // TLS certificate validation stays at its secure default; never set
    // `rejectUnauthorized: false` here.
  });
}

function requireString(rawArguments: JsonObject, field: string): string {
  const value = rawArguments[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`email.send requires a non-empty "${field}" argument.`);
  }
  return value;
}

function classifyError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
  }
  return "unknown error";
}
