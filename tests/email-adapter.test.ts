import { SimulatedEmailHandler } from "@trustclaw/email-adapter";
import { createEmailHandler, resolveEmailMode, SmtpEmailHandler } from "@trustclaw/email-adapter";
import { describe, expect, it } from "vitest";

describe("simulated email handler", () => {
  it("never contacts a mail server and never echoes recipient/body into its summary", async () => {
    const handler = new SimulatedEmailHandler();
    const outcome = await handler.execute(
      "email.send",
      { to: "someone@example.test", subject: "s", body: "secret-body-marker" },
      "request-1",
    );

    expect(outcome.status).toBe("succeeded");
    expect(outcome.summary).not.toContain("secret-body-marker");
    expect(outcome.summary).not.toContain("someone@example.test");
  });

  it("rejects an unsupported action", async () => {
    const handler = new SimulatedEmailHandler();
    await expect(
      handler.execute("gmail.delete_email", {}, "request-1"),
    ).rejects.toThrow();
  });
});

describe("resolveEmailMode", () => {
  it("defaults to simulated", () => {
    expect(resolveEmailMode({})).toBe("simulated");
  });

  it("only switches to real on an explicit opt-in", () => {
    expect(resolveEmailMode({ TRUSTCLAW_EMAIL_MODE: "real" })).toBe("real");
    expect(resolveEmailMode({ TRUSTCLAW_EMAIL_MODE: "REAL" })).toBe("simulated");
  });
});

describe("createEmailHandler", () => {
  it("fails closed when real mode is requested without SMTP configuration", () => {
    expect(() => createEmailHandler("real", {})).toThrow(/fail closed/i);
  });

  it("fails closed on a non-numeric port", () => {
    expect(() =>
      createEmailHandler("real", {
        TRUSTCLAW_SMTP_HOST: "smtp.example.test",
        TRUSTCLAW_SMTP_PORT: "not-a-number",
        TRUSTCLAW_SMTP_USER: "user",
        TRUSTCLAW_SMTP_PASS: "pass",
        TRUSTCLAW_SMTP_FROM: "from@example.test",
      }),
    ).toThrow();
  });

  it("never falls back to the simulated handler when real mode is misconfigured", () => {
    let created: unknown;
    try {
      created = createEmailHandler("real", {});
    } catch {
      created = undefined;
    }
    expect(created).toBeUndefined();
  });

  it("builds a real SMTP handler when fully configured", () => {
    const handler = createEmailHandler(
      "real",
      {
        TRUSTCLAW_SMTP_HOST: "smtp.example.test",
        TRUSTCLAW_SMTP_PORT: "587",
        TRUSTCLAW_SMTP_USER: "user",
        TRUSTCLAW_SMTP_PASS: "pass",
        TRUSTCLAW_SMTP_FROM: "from@example.test",
      },
      () => ({ sendMail: async () => undefined }),
    );
    expect(handler).toBeInstanceOf(SmtpEmailHandler);
  });

  it("rejects an unknown mode", () => {
    expect(() => createEmailHandler("bogus" as never, {})).toThrow(/Unknown TrustClaw email mode/);
  });
});

describe("SmtpEmailHandler", () => {
  it("reports adapter failures as a failed execution outcome, not a thrown false success", async () => {
    const handler = new SmtpEmailHandler(
      {
        host: "smtp.example.test",
        port: 587,
        secure: false,
        user: "user",
        pass: "super-secret-password",
        from: "from@example.test",
      },
      () => ({
        sendMail: async () => {
          throw Object.assign(new Error("boom"), { code: "ECONNECTION" });
        },
      }),
    );

    const outcome = await handler.execute(
      "email.send",
      { to: "someone@example.test", subject: "s", body: "b" },
      "request-1",
    );

    expect(outcome.status).toBe("failed");
    expect(outcome.summary).not.toContain("super-secret-password");
  });

  it("succeeds when the transport accepts the message", async () => {
    const sent: unknown[] = [];
    const handler = new SmtpEmailHandler(
      {
        host: "smtp.example.test",
        port: 587,
        secure: false,
        user: "user",
        pass: "super-secret-password",
        from: "from@example.test",
      },
      () => ({
        sendMail: async (message) => {
          sent.push(message);
          return { messageId: "1" };
        },
      }),
    );

    const outcome = await handler.execute(
      "email.send",
      { to: "someone@example.test", subject: "s", body: "b" },
      "request-1",
    );

    expect(outcome.status).toBe("succeeded");
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(outcome)).not.toContain("super-secret-password");
  });
});
