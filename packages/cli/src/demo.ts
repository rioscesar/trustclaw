import { runScenario } from "./scenario.js";

const nonInteractive = process.argv.includes("--yes");
const { audit, executed, risk } = await runScenario(nonInteractive);
const verification = audit.verify();

console.log(`Risk: ${risk}`);
console.log(`Simulated tool executed: ${executed}`);
console.log(
  `Audit events: ${audit
    .list()
    .map((event) => event.eventType)
    .join(" -> ")}`,
);
console.log(`Audit chain valid: ${verification.valid}`);

if (!executed || !verification.valid) {
  process.exitCode = 1;
}
