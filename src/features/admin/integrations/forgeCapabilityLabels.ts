// The per-forge observability table, in reader-facing words.
//
// WHY THIS IS A STATIC TABLE AND NOT A LIVE READ. The obvious implementation derives each row from
// `forgeCapabilities("gitlab")` — the adapter's own compiled manifest — so the card could not claim a
// capability the code lacks. That import is a CLIENT/SERVER BOUNDARY BREAK: this module is reached
// from a `"use client"` card, and `@/lib/forge/registry` pulls in the local-working-copy adapter,
// which pulls `node:fs/promises` and `child_process`. `tsc` and the whole vitest suite stay green on
// it; `next build` fails. (Caught here by exactly that: a build failure with a clean typecheck.)
//
// So the values are literals, and `forgeCapabilityLabels.test.ts` asserts them against
// `forgeCapabilities("gitlab")` on the SERVER side. The "cannot drift from the code" property is kept
// — it is enforced by a test that runs in a node environment instead of by an import that drags the
// server graph into the browser bundle. Change a capability in the adapter and the test names the row
// to update here.

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

/** Mirror of `GITLAB_CAPABILITIES` (src/lib/forge/gitlab/source.ts). Held to it by the sibling test. */
const GITLAB: Record<keyof ForgeCapabilities, boolean> = {
  pullRequests: true,
  branchGovernance: true,
  deployments: true,
  ciHealth: true,
  securityPosture: false,
  securityExposure: false,
  appInventory: false,
  codeowners: true,
  write: false,
  anonymous: false,
};

/** Display order: what GitLab CAN be asked first, then the gaps — but both in one list, so the card
 *  never reads as a pure feature advertisement. */
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

export const CAPABILITY_LABELS: { key: keyof ForgeCapabilities; label: string; gitlab: boolean }[] =
  ORDER.map((key) => ({ key, label: LABELS[key], gitlab: GITLAB[key] }));
