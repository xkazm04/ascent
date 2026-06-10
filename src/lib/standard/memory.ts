// Structured codebase MEMORY — `.ai/memory/`. An append-only, agent-written store of the things a
// repo learns: decisions, gotchas, and crucially a "tried and failed" ledger so agents don't repeat
// dead ends. One fact per file with frontmatter; the format is pointed at from the manifest
// (`paths.memory`), so it can evolve without touching the contract. Pure/deterministic.

import type { ScanReport } from "@/lib/types";
import type { GeneratedFile } from "./types";

const README = `# \`.ai/memory\` — the codebase's durable memory

Structured, **append-only** memory that agents read *before* acting and write *after* learning. It
exists so hard-won knowledge — why a decision was made, a non-obvious gotcha, an approach that was
tried and **failed** — survives past a single session and isn't rediscovered the hard way.

This is not prose drift in a guidance file. It is one fact per file, each with frontmatter so it can
be indexed, filtered, and superseded. The format is referenced from \`.ai/manifest.yaml\`
(\`paths.memory\`), so it can change without breaking the contract.

## One fact per file

Name files \`NNNN-short-slug.md\` (zero-padded, monotonic). Frontmatter schema:

    ---
    id: 0007
    kind: failed-approach   # decision | gotcha | failed-approach | convention | reference | <open>
    scope: module:engine    # repo | path:<dir> | module:<id>
    date: 2026-06-10
    supersedes: null        # id of a memory this replaces, or null
    refs: []                # related memory ids or module ids
    ---

    One paragraph: what was learned, and — for a decision — **why**. For a failed-approach, say what
    was tried and the symptom that ruled it out, so no one (human or agent) burns the same hours.

\`kind\` and \`scope\` are an **open vocabulary** — add values when you need them; readers ignore ones
they don't recognize.

## The norms that make it work

- **Before a non-trivial change:** scan memories whose \`scope\` covers the files you're about to touch.
- **After a non-trivial change:** if you learned something durable (a decision, a gotcha, a dead end),
  append a memory. Keep it to one fact.
- **Never rewrite history.** Superseding beats editing: add a new file and set \`supersedes\`.
- **Vendor-neutral.** Any coding agent can read and write this; it names no tool.

The first entry below records adopting this standard — it doubles as a worked example of the format.
`;

export function buildMemorySeed(report: ScanReport): GeneratedFile[] {
  const date = report.scannedAt.slice(0, 10);
  const seed = `---
id: 0001
kind: decision
scope: repo
date: ${date}
supersedes: null
refs: []
---

Adopted the \`.ai/\` AI-native standard (manifest + structured memory + a co-located CONTEXT graph +
an executable \`doctor\`) on ${date}, seeded from an Ascent scan. **Why:** make the repo legible,
verifiable, and self-maintaining for agents, and shift maturity controls left of CI — the agent
self-certifies pre-push, CI is the thin backstop. See \`.ai/manifest.yaml\` and \`${"docs/AI_MANIFEST_SPEC.md"}\`.
`;

  return [
    { path: ".ai/memory/README.md", body: README, purpose: "How the durable memory store works (schema + norms).", lang: "markdown" },
    {
      path: ".ai/memory/0001-adopt-ai-standard.md",
      body: seed,
      purpose: "Seed memory entry — records adopting the standard and demonstrates the format.",
      lang: "markdown",
    },
  ];
}
