// The projection header — the one format shared by the repo-side generator (`.ai/maintain.mjs
// project`, emitted from src/lib/standard/maintain.ts), the repo-side checker (`.ai/doctor.mjs`) and
// the scanner's guidance graph.
//
// A "projection" is a vendor guidance file GENERATED from the repo's canonical one: `.cursor/rules/*`
// or `.github/copilot-instructions.md` holding the same body as `AGENTS.md`. The header records two
// hashes, and the pair is what makes drift diagnosable rather than merely visible:
//
//   generated-from: <path> <sha256:12 of the SOURCE body>
//   body:           <sha256:12 of THIS file's own body>
//
// - source hash differs from the canonical file's current hash  → STALE (the canonical moved on;
//   re-run the generator). A warning, never a failure: nothing is wrong, it is just behind.
// - body hash differs from this file's own body                 → HAND-EDITED (someone changed the
//   projection instead of the source). A failure: the repo now has two sources of truth, which is
//   the exact condition this whole item exists to remove.
//
// Kept in ONE module so the three readers cannot disagree about the format. `node:crypto` only —
// zero dependencies, matching the constraint the emitted `.ai/` scripts run under.

import { createHash } from "node:crypto";

/** The first 12 hex characters of the sha256 — short enough to read in a diff, long enough that an
 *  accidental collision between two versions of one document is not a practical concern. */
export function sha12(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

export interface ProjectionHeader {
  /** Repo-relative path of the canonical document this file was generated from. */
  sourcePath: string;
  /** sha12 of the canonical body at generation time. */
  sourceHash: string;
  /** sha12 of this file's own body at generation time. */
  bodyHash: string;
}

/** Matches the header this module renders, and nothing else. Anchored to the line so a header quoted
 *  inside a document's prose (a spec explaining the format — this repo does exactly that) is not
 *  mistaken for the document's own provenance. */
const HEADER_RE =
  /^[ \t]*<!--[ \t]*generated-from:[ \t]*(\S+)[ \t]+sha256:([0-9a-f]{12})[ \t]*·[ \t]*body:[ \t]*sha256:([0-9a-f]{12})[^>]*-->[ \t]*$/m;

export const PROJECTION_COMMAND = "node .ai/maintain.mjs project";

export function renderProjectionHeader(h: ProjectionHeader): string {
  return (
    `<!-- generated-from: ${h.sourcePath} sha256:${h.sourceHash} · body: sha256:${h.bodyHash} · ` +
    `do not edit; run: ${PROJECTION_COMMAND} -->`
  );
}

/** Read a projection header out of a file's text, or null when the file is not a projection. */
export function parseProjectionHeader(text: string | null | undefined): ProjectionHeader | null {
  if (!text) return null;
  const m = HEADER_RE.exec(text);
  if (!m) return null;
  return { sourcePath: m[1] ?? "", sourceHash: m[2] ?? "", bodyHash: m[3] ?? "" };
}

/**
 * The part of a projection file that is the BODY — everything after the header line, with any
 * vendor front matter (Cursor `.mdc` requires a `---` block first) removed.
 *
 * A file with no header is all body: that is what lets the same function hash the canonical source
 * and hash a projection, which is the property the two hashes are compared under.
 */
export function projectionBody(text: string): string {
  let out = text;
  // Front matter only counts when it opens the file — a `---` rule in the middle of prose is content.
  const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/.exec(out);
  if (fm && fm.index === 0) out = out.slice(fm[0].length);
  const m = HEADER_RE.exec(out);
  if (m) out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
  // Leading blank lines are transport, not content: the renderer puts one after the header, so
  // including it would make a round-trip fail to reproduce its own body hash.
  return out.replace(/^(\r?\n)+/, "");
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
 * generator over an unchanged canonical writes a byte-identical file (a done-criterion of #15).
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
 * Classify a projection file against the canonical body it claims to come from.
 *
 * `canonicalBody` null means the canonical text was not sampled by this scan — the answer is then
 * honestly unknown rather than "stale", so the source-hash comparison is skipped and only the
 * self-contained body check (which needs no second file) runs.
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
