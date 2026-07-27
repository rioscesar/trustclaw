import { randomUUID } from "node:crypto";

import {
  canonicalize,
  isAuditEvent,
  sha256Digest,
  type AuditEvent,
  type AuditEventType,
  type JsonObject,
  type JsonValue,
} from "@trustclaw/contracts";

export interface AuditEventInput {
  eventType: AuditEventType;
  timestamp: string;
  requestId: string;
  metadata: JsonObject;
}

export interface AuditVerification {
  valid: boolean;
  eventCount: number;
  invalidIndex?: number;
  reason?: string;
}

export interface AuditStore {
  append(input: AuditEventInput): AuditEvent | PromiseLike<AuditEvent>;
  list(): readonly AuditEvent[] | PromiseLike<readonly AuditEvent[]>;
  verify(): AuditVerification | PromiseLike<AuditVerification>;
}

type EventWithoutDigest = Omit<AuditEvent, "digest">;

function eventDigest(event: EventWithoutDigest): string {
  return sha256Digest(event as unknown as JsonValue);
}

function cloneEvent(event: AuditEvent): AuditEvent {
  return JSON.parse(canonicalize(event as unknown as JsonValue)) as AuditEvent;
}

export class InMemoryAuditStore implements AuditStore {
  private events: AuditEvent[] = [];

  append(input: AuditEventInput): AuditEvent {
    const previousDigest = this.events.at(-1)?.digest ?? null;
    const unsigned: EventWithoutDigest = {
      schemaVersion: "1.0",
      eventId: randomUUID(),
      ...input,
      previousDigest,
    };
    const event: AuditEvent = { ...unsigned, digest: eventDigest(unsigned) };
    this.events.push(event);
    return cloneEvent(event);
  }

  list(): readonly AuditEvent[] {
    return this.events.map(cloneEvent);
  }

  verify(): AuditVerification {
    let expectedPrevious: string | null = null;

    for (const [index, event] of this.events.entries()) {
      if (!isAuditEvent(event)) {
        return {
          valid: false,
          eventCount: this.events.length,
          invalidIndex: index,
          reason: "Audit event does not match the runtime contract.",
        };
      }
      if (event.previousDigest !== expectedPrevious) {
        return {
          valid: false,
          eventCount: this.events.length,
          invalidIndex: index,
          reason: "Previous digest does not match the preceding event.",
        };
      }

      const { digest, ...unsigned } = event;
      const expectedDigest = eventDigest(unsigned);
      if (digest !== expectedDigest) {
        return {
          valid: false,
          eventCount: this.events.length,
          invalidIndex: index,
          reason: "Current event digest does not match its contents.",
        };
      }
      expectedPrevious = digest;
    }

    return { valid: true, eventCount: this.events.length };
  }

  /** Deliberately unsafe hook used only by the tamper demo and verifier tests. */
  unsafeTamperForDemo(
    index: number,
    mutate: (event: AuditEvent) => AuditEvent,
  ): void {
    const event = this.events[index];
    if (event === undefined) {
      throw new RangeError(`No audit event exists at index ${index}.`);
    }
    this.events[index] = mutate(cloneEvent(event));
  }

  /** Deliberately unsafe hook used only to prove removal detection. */
  unsafeRemoveForDemo(index: number): void {
    this.events.splice(index, 1);
  }

  /** Deliberately unsafe hook used only to prove reorder detection. */
  unsafeSwapForDemo(left: number, right: number): void {
    const leftEvent = this.events[left];
    const rightEvent = this.events[right];
    if (leftEvent === undefined || rightEvent === undefined) {
      throw new RangeError("Cannot swap a missing audit event.");
    }
    this.events[left] = rightEvent;
    this.events[right] = leftEvent;
  }
}
