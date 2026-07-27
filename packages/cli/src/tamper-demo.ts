import { runScenario } from "./scenario.js";

const { audit } = await runScenario(true);
const before = audit.verify();
audit.unsafeTamperForDemo(1, (event) => ({
  ...event,
  metadata: { ...event.metadata, risk: "low" },
}));
const after = audit.verify();

console.log(`Valid before tampering: ${before.valid}`);
console.log(`Valid after tampering: ${after.valid}`);
console.log(`Verifier reason: ${after.reason ?? "none"}`);

if (!before.valid || after.valid) {
  process.exitCode = 1;
}
