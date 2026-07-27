import { InMemoryAuditStore } from "@trustclaw/gateway";
import { describe, expect, it } from "vitest";

function chain(): InMemoryAuditStore {
  const audit = new InMemoryAuditStore();
  for (const [index, eventType] of [
    "request",
    "policy_decision",
    "approval",
    "execution",
    "outcome",
  ].entries()) {
    audit.append({
      eventType: eventType as
        "request" | "policy_decision" | "approval" | "execution" | "outcome",
      timestamp: `2026-07-26T18:00:0${index}.000Z`,
      requestId: "request-1",
      metadata: { sequence: index },
    });
  }
  return audit;
}

describe("audit chain verification", () => {
  it("accepts a valid chain", () => {
    expect(chain().verify()).toEqual({ valid: true, eventCount: 5 });
  });

  it("detects changed event contents", () => {
    const audit = chain();
    audit.unsafeTamperForDemo(2, (event) => ({
      ...event,
      metadata: { sequence: 99 },
    }));
    expect(audit.verify()).toMatchObject({ valid: false, invalidIndex: 2 });
  });

  it("detects reordered events", () => {
    const audit = chain();
    audit.unsafeSwapForDemo(1, 2);
    expect(audit.verify()).toMatchObject({ valid: false, invalidIndex: 1 });
  });

  it("detects a removed middle event", () => {
    const audit = chain();
    audit.unsafeRemoveForDemo(2);
    expect(audit.verify()).toMatchObject({ valid: false, invalidIndex: 2 });
  });

  it("detects an incorrect previous digest", () => {
    const audit = chain();
    audit.unsafeTamperForDemo(2, (event) => ({
      ...event,
      previousDigest: `sha256:${"f".repeat(64)}`,
    }));
    expect(audit.verify()).toMatchObject({
      valid: false,
      invalidIndex: 2,
      reason: "Previous digest does not match the preceding event.",
    });
  });

  it("detects an incorrect current digest", () => {
    const audit = chain();
    audit.unsafeTamperForDemo(2, (event) => ({
      ...event,
      digest: `sha256:${"f".repeat(64)}`,
    }));
    expect(audit.verify()).toMatchObject({
      valid: false,
      invalidIndex: 2,
      reason: "Current event digest does not match its contents.",
    });
  });
});
