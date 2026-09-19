// The HASHING half of the projection contract — the provenance header's two sha256 stamps, and the
// renderer that writes them.
//
// A "projection" is a vendor guidance file GENERATED from the repo's canonical one: `.cursor/rules/*`
// or `.github/copilot-instructions.md` holding the same body as `AGENTS.md`. The header records two
// hashes, and the PAIR is what makes drift diagnosable rather than merely visible:
//
//   generated-from: <path> sha256:<12 of the SOURCE body>  ·  body: sha256:<12 of THIS file's body>
//
// - source hash ≠ the canonical's current hash → STALE (the canonical moved on; re-run the
//   generator). A warning, never a failure: nothing is wrong, it is just behind.
// - body hash ≠ this file's own body hash      → HAND-EDITED (someone changed the projection instead
//   of the source). A failure: the repo now has two sources of truth, which is the exact condition
//   this whole item exists to remove.
//
// WHY THIS IS A SEPARATE MODULE FROM THE HEADER ITSELF. Hashing means `node:crypto`, and the header's
// PARSER is needed by `guidance-graph.ts`, which is reachable from `scoring/engine.ts`, which client
// components import — a Node built-in on that path breaks `next build` while `tsc` and the whole unit
// suite stay green. So the format is defined once in `guidance-graph.ts` (crypto-free) and this module
// imports it: the dependency runs projection → graph, never the other way.
//
// The scanner therefore answers only "is this projection still identical to its source?"; the
// stale-vs-hand-edited split is made by the repo's own `.ai/doctor.mjs`, which runs in Node. That is
// the intended division of labour, not a limitation: the graph is the arbiter, the manifest is where
// the verdict is declared, and the doctor is where it is enforced in-repo.

import { createHash } from "node:crypto";
import { PROJECTION_HEADER_RE, parseProjectionHeader, projectionBody, type ProjectionHeader } from "@/lib/analyze/guidance-graph";

export { parseProjectionHeader, projectionBody, PROJECTION_HEADER_RE };
export type { ProjectionHeader };

/** The first 12 hex characters of the sha256 — short enough to read in a diff, long enough that an
 *  accidental collision between two versions of one document is not a practical concern. Mirrors the
 *  `sha12` the generated `.ai/maintain.mjs` and `.ai/doctor.mjs` define, byte for byte. */
export function sha12(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

export const PROJECTION_COMMAND = "node .ai/maintain.mjs project";

export function renderProjectionHeader(h: ProjectionHeader): string {
  return (
    `<!-- generated-from: ${h.sourcePath} sha256:${h.sourceHash} · body: sha256:${h.bodyHash} · ` +
    `do not edit; run: ${PROJECTION_COMMAND} -->`
  );
}

export interface RenderProjectionInput {
  /** Repo-relative path of the canonical document. */
  sourcePath: string;
  /** The canonical document's full text — copied verbatim into the projection. */
  sourceBody: string;
  /** Vendor front matter to place BEFORE the header (Cursor `.mdc`). Include its `---` fences. */
  frontMatter?: string;
}

/**
 * Render a projection file: [front matter] + header + the canonical body verbatim.
 *
 * Idempotent by construction — the output is a pure function of the inputs, so a second run of the
 * generator over an unchanged canonical writes a byte-identical file (a done-criterion of #15). This
 * is the TypeScript mirror of what `.ai/maintain.mjs project` does in the adopting repo; the two are
 * kept in step by `standard.test.ts` and by the round-trip test beside this file.
 */
export function renderProjection(input: RenderProjectionInput): string {
  const body = input.sourceBody.replace(/^(\r?\n)+/, "");
  const header = renderProjectionHeader({
    sourcePath: input.sourcePath,
    sourceHash: sha12(input.sourceBody),
    bodyHash: sha12(body),
  });
  const fm = input.frontMatter ? input.frontMatter.replace(/\r?\n*$/, "\n") : "";
  return `${fm}${header}\n\n${body}`;
}

export type ProjectionState = "in-sync" | "stale" | "hand-edited" | "not-a-projection";

/**
 * Classify a projection file against the canonical body it claims to come from — the full four-state
 * read the doctor makes, available here so the two implementations can be tested against each other.
 *
 * `canonicalBody` null means the canonical text was not sampled — the answer is then honestly unknown
 * rather than "stale", so the source comparison is skipped and only the self-contained body check
 * (which needs no second file) runs.
 */
export function projectionState(
  text: string,
  canonicalBody: string | null,
): { state: ProjectionState; header: ProjectionHeader | null } {
  const header = parseProjectionHeader(text);
  if (!header) return { state: "not-a-projection", header: null };
  if (sha12(projectionBody(text)) !== header.bodyHash) return { state: "hand-edited", header };
  if (canonicalBody != null && sha12(canonicalBody) !== header.sourceHash) return { state: "stale", header };
  return { state: "in-sync", header };
}
