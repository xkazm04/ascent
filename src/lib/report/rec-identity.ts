// The cross-scan IDENTITY of a roadmap recommendation, in one pure place.
//
// This function used to live in src/lib/db/org-decisions.ts, which is a server module (Prisma, memory
// write-through, audit). The Roadmap Sandbox needs the SAME key in the browser — a saved scenario
// stores which gaps it modeled, and restoring it means matching those stored keys against the roadmap
// the report is currently rendering. Importing org-decisions.ts from a client component would drag the
// whole DB graph across the client/server boundary (a `tsc`-clean, test-clean, BUILD-breaking mistake;
// see memory: build-not-in-gate). So the derivation moved here — framework-free, no data access — and
// org-decisions.ts re-exports it. There is still exactly ONE implementation; only its home changed.
//
// Its dependencies are both already pure: `fnv1a` (org/findings.ts, "framework-free: no Prisma, no
// React, no db imports") and `normalizeRecTitle` (report/compare.ts, the pure diff engine).

import { fnv1a } from "@/lib/org/findings";
import { normalizeRecTitle } from "@/lib/report/compare";

/**
 * The cross-scan identity of a roadmap recommendation, usable as an OrgDecision itemKey.
 *
 * Prefixed with the repo's fullName so `decisionsForRepo`'s exact prefix match picks it up unchanged,
 * and hashed over `normalizeRecTitle` — THE SAME normalizer scan-persist carry-forward and the
 * "what changed" diff use — so a live-LLM rephrasing of case/punctuation/whitespace keeps a stored
 * judgment attached to the gap it was made about. A materially reworded gap hashes differently and is
 * a NEW finding, which is correct: the reason was given about the old statement.
 */
export function recommendationDecisionKey(fullName: string, dimension: string, title: string): string {
  return `${fullName}::rec:${dimension}:${fnv1a(normalizeRecTitle(title))}`;
}
