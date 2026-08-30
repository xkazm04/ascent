// The per-forge observability table, in reader-facing words.
//
// It is DERIVED from `forgeCapabilities("gitlab")` — the adapter's own compiled manifest — rather than
// hand-listed, so the card cannot claim a capability the code does not have. That is the same reason
// `github-parity.test.ts` asserts the manifest against bound members: a capability table is only worth
// showing if it is a statement about the code.

import { forgeCapabilities } from "@/lib/forge/registry";
import type { ForgeCapabilities } from "@/lib/forge/types";

const LABELS: Record<keyof ForgeCapabilities, string> = {
  pullRequests: "Merge requests, approvals and AI attribution",
  branchGovernance: "Protected branches, approvals and push rules",
  deployments: "Environments and deployments",
  ciHealth: "Pipeline success rate and duration",
  securityPosture: "Platform-published advisories and policy",
  securityExposure: "Open dependency vulnerabilities from the lockfile",
  appInventory: "Apps posting checks on the scored commit",
  codeowners: "CODEOWNERS ownership",
  write: "Writing PR gate comments and check runs",
  anonymous: "Keyless scanning of a public project",
};

const ORDER: (keyof ForgeCapabilities)[] = [
  "pullRequests",
  "branchGovernance",
  "ciHealth",
  "deployments",
  "codeowners",
  "securityPosture",
  "securityExposure",
  "appInventory",
  "write",
  "anonymous",
];

export const CAPABILITY_LABELS: { key: keyof ForgeCapabilities; label: string; gitlab: boolean }[] = ORDER.map(
  (key) => ({ key, label: LABELS[key], gitlab: forgeCapabilities("gitlab")[key] }),
);
