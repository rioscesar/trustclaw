import { createHash } from "node:crypto";

import type { JsonValue } from "./schemas.js";

function serialize(value: JsonValue): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers");
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${serialize(item)}`)
    .join(",")}}`;
}

export function canonicalize(value: JsonValue): string {
  return serialize(value);
}

export function sha256Digest(value: JsonValue): string {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}
