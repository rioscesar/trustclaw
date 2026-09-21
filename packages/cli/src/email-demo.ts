import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import {
  runEmailScenario,
  findApprover,
  type ScenarioName,
} from "./email-scenarios.js";
import { formatAuthorizedEvidence, formatDeniedEvidence } from "./evidence.js";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

const scenarioArg = process.argv.find((value) =>
  value.startsWith("--scenario="),
);
const requested = scenarioArg?.split("=")[1] ?? "approve";
const interactive = process.argv.includes("--interactive");

if (requested !== "allow" && requested !== "approve" && requested !== "deny") {
  console.error(
    `Unknown scenario "${requested}". Use --scenario=allow|approve|deny.`,
  );
  process.exitCode = 1;
  process.exit();
}

const name: ScenarioName = requested;
const { result, audit } = await runEmailScenario(name, { interactive });
const verification = audit.verify();

if (result.succeeded) {
  console.log(
    formatAuthorizedEvidence({
      agentId: "openclaw-demo",
      action: "send_email",
      policy: result.decision.policyVersion,
      approver: findApprover(audit) ?? "n/a (no approval required)",
      timestamp: result.outcome?.completedAt ?? new Date().toISOString(),
      requestDigest: result.requestDigest,
      auditVerified: verification.valid,
    }),
  );
} else {
  console.log(
    formatDeniedEvidence({
      agentId: "openclaw-demo",
      action: "send_email",
      policy: result.decision.policyVersion,
      reason: result.denialReason ?? result.decision.reason,
      requestDigest: result.requestDigest,
    }),
  );
}

const expectedSuccess = name !== "deny";
if (expectedSuccess !== result.succeeded || !verification.valid) {
  process.exitCode = 1;
}
