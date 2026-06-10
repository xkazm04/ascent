// The co-located CONTEXT graph — a `CONTEXT.md` per significant module, indexed in
// `.ai/context-index.json`. Docs designed for an agent to bootstrap a module from cold, with
// FRESHNESS as a first-class property: the index records which source files a CONTEXT was written
// from, so the doctor can flag drift (a CONTEXT that references code that no longer exists).
//
// We generate the template + the index seed + the rule; the running agent fills per-module CONTEXT
// files against the live code (it can see the real modules; we can't from a scan). Pure/deterministic.

import type { ScanReport } from "@/lib/types";
import type { GeneratedFile } from "./types";

const TEMPLATE = `# CONTEXT: <module path>

> Co-located, agent-readable context for this module. Keep it short and TRUE. When the code here
> changes materially, update this file in the same change (the doctor flags it as stale otherwise).

## Owns
What this module is responsible for, in one or two sentences.

## Public contract
The surface other code/agents depend on (exports, routes, events, schema). Changing these is a
breaking change — call it out.

## Invariants — never break
- <e.g. "all DB access goes through repo.ts; never raw SQL here">
- <e.g. "no secrets read directly; use the vault capability">

## Key files
- \`<file>\` — <what it does>

## Data flow
How data enters, moves through, and leaves this module.

## Decisions & memory
Links to ADRs / \`.ai/memory\` entries that explain *why* this module is the way it is.
`;

export function buildContextScaffold(report: ScanReport): GeneratedFile[] {
  const index = {
    schemaVersion: "0.1.0",
    // Each module: stable id (durable across path moves), the CONTEXT file, what it owns, and the
    // git sha its CONTEXT was last reconciled to — the freshness anchor.
    modules: [
      {
        id: "root",
        path: ".",
        context: "CONTEXT.md",
        owns: report.repo.description?.trim() || "TODO: what the repo is for",
        reconciledToSha: report.repo.headSha ?? null,
      },
    ],
  };

  return [
    {
      path: "CONTEXT.md",
      body: TEMPLATE,
      purpose: "Template for a per-module CONTEXT doc (copy into each significant module directory).",
      lang: "markdown",
    },
    {
      path: ".ai/context-index.json",
      body: JSON.stringify(index, null, 2) + "\n",
      purpose: "Index of the CONTEXT graph with per-module freshness anchors.",
      lang: "json",
    },
  ];
}
