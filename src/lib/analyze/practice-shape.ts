// Practice SHAPE extraction (W6) — the structure of what a repo actually does, without its code.
//
// `docs/VISION-TRANSITION.md` §Pillar 2 promised that the org's strongest repos would have their
// institutional knowledge **templatized and offered to the repos that lack it** — "the reusable
// shape travels; the code doesn't". The implementation collapsed to nine hand-written starters, one
// per dimension, identical for every customer. An org that applied all nine had exhausted the
// product, and the starters described a generic good practice rather than *this org's* practice.
//
// This is the missing half: read the exemplar's real artifacts and record their SHAPE.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT "SHAPE" MEANS, AND WHY IT IS LEAK-SAFE.
//
// Two kinds of structure are extracted, and NEITHER carries an artifact's body:
//
//   OUTLINE  — the markdown heading outline of a guidance file, PR template or ADR. Headings are the
//              document's skeleton; the prose and any code fences under them are never read.
//   LAYOUT   — the directory/file layout of a harness or workflow set, path segments only.
//
// The leak boundary the vision draws is **proprietary code**, and the travel is repo→repo INSIDE one
// organization. An org's own headings moving to its own other repo is precisely the intended reuse.
// What must never travel is the body — that is where the code, the credentials and the customer
// names live — so the body is not extracted at all rather than extracted-and-filtered.
//
// STRICTLY ORG-INTERNAL. A mined shape is one org's private structure. Nothing here may reach a
// public report, the shared public corpus, or another tenant: `getOrgPracticeShapes` is org-scoped,
// and there is deliberately no shape field on any public surface.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

import type { FetchedFile, RepoFile } from "@/lib/types";
import { contentDigest } from "@/lib/registry/parse";

/** Caps. A shape is a skeleton, not a copy — these bound both the blob and the leak surface. */
const MAX_HEADINGS = 24;
const MAX_HEADING_CHARS = 90;
const MAX_PATHS = 20;
const MAX_FILES_PER_PRACTICE = 2;
/** MOONSHOT #33 — census cap. A repo with more practice artifacts than this is not being audited
 *  file-by-file; the ledger only ever keys on paths ascent itself wrote, which is a small set. */
const MAX_CENSUS = 40;

/** One artifact's extracted structure. */
export interface ShapeEntry {
  /** The practice this evidences — an id from src/lib/practices.ts. */
  practiceId: string;
  path: string;
  /** Markdown heading outline (H1–H3), in document order. Empty for a layout-only shape. */
  outline: string[];
  /** Path segments that make up the practice's layout. Empty for an outline-only shape. */
  layout: string[];
}

/**
 * MOONSHOT #33 — one census row: a practice-artifact path that EXISTS in the repo's tree, plus the
 * digests of what is in it. Body-free by construction (two hashes and a path), so the leak boundary
 * this module draws is unchanged: digests and paths travel, bodies do not.
 *
 * `bodyHash: null` means the path is in the tree but its body was outside the fetch budget —
 * **unknown, never "changed"**. The reconciler must not read a null as drift or as removal.
 */
export interface CensusArtifact {
  path: string;
  /** `contentDigest` of the fetched body, or null when the body was not fetched. */
  bodyHash: string | null;
  /** `contentDigest` over the file's heading outline, or null for a non-markdown / heading-free file. */
  outlineHash: string | null;
}

export interface RepoPracticeShape {
  /** `"1"` = pre-census (no `artifacts`); `"2"` = carries the #33 artifact census. */
  version: "1" | "2";
  entries: ShapeEntry[];
  /**
   * MOONSHOT #33 — every practice-artifact blob in the tree, with digests. Absent on a v1 shape,
   * which makes adoption reconciliation a no-op for scans taken before this landed (correct: an old
   * scan is not evidence that a file was removed).
   */
  artifacts?: CensusArtifact[];
  /**
   * The tree this census was taken over was TRUNCATED, so "path absent" proves nothing. Reconciliation
   * refuses to mark a row `removed` when this is true. Absent on a v1 shape.
   */
  truncated?: boolean;
}

/**
 * Markdown heading outline, H1–H3, in document order.
 *
 * FENCED BLOCKS ARE SKIPPED. A `#` inside a ``` block is a shell comment or a CSS id, not a heading —
 * and following it would pull a line of someone's actual script into the "shape". This is the one
 * place body content could leak into an outline, so it is handled explicitly rather than by regex luck.
 */
export function outlineOf(markdown: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[2]!.replace(/\s+/g, " ").trim();
    if (!text) continue;
    out.push(`${"#".repeat(m[1]!.length)} ${text.slice(0, MAX_HEADING_CHARS)}`);
    if (out.length >= MAX_HEADINGS) break;
  }
  return out;
}

/** Path patterns whose LAYOUT evidences a practice (no file body is read for these). */
const LAYOUT_RULES: { practiceId: string; re: RegExp }[] = [
  { practiceId: "ai-harness", re: /(^|\/)(evals?|golden|promptfoo|prompts?)\// },
  { practiceId: "ci-gates", re: /^\.github\/workflows\/[^/]+\.ya?ml$/ },
  { practiceId: "docs-adrs", re: /(adr|decisions?)\/.*\.mdx?$/ },
];

/** Path patterns whose OUTLINE evidences a practice (markdown skeleton, never the body). */
const OUTLINE_RULES: { practiceId: string; re: RegExp }[] = [
  { practiceId: "agent-guidance", re: /(^|\/)(claude|agents?)\.md$/i },
  { practiceId: "enforced-quality", re: /(^|\/)(contributing)\.md$/i },
  { practiceId: "legible-history", re: /pull_request_template\.md$/i },
  { practiceId: "docs-adrs", re: /(adr|decisions?)\/.*\.mdx?$/i },
];

/**
 * MOONSHOT #33 — the paths a practice artifact can LAND at, so the census can answer "is what we
 * wrote still there?" for every writer in the product:
 *
 *  - the nine fixed paths `buildArtifact` commits (src/lib/practice-artifact.ts),
 *  - `docs/practices/<slug>.md`, where a registry PRACTICE.md starter lands,
 *  - `docs/playbooks/<id>-<slug>.md`, where `applyPlaybookToRepo` commits,
 *  - and the OUTLINE_RULES / LAYOUT_RULES patterns above, so a repo that already had the artifact
 *    before ascent ever touched it is measured on the same footing.
 *
 * Deliberately a LOCAL list rather than an import of `PRACTICES` / `buildArtifact`: this module is the
 * leak boundary and stays free of the artifact GENERATOR, whose bodies must never reach a scan.
 * The paths are asserted against the generator in practice-shape.census.test.ts, so a new practice
 * that writes a new path fails a test here rather than silently falling out of the census.
 */
const CENSUS_FIXED_PATHS = [
  "agents.md",
  "docs/testing.md",
  ".github/workflows/ci.yml",
  ".github/workflows/ai-review.yml",
  "docs/adr/0001-record-architecture-decisions.md",
  ".github/pull_request_template.md",
  "docs/commit_conventions.md",
  "docs/ai_harness.md",
  "security.md",
];

const CENSUS_EXTRA_RULES: RegExp[] = [
  /^docs\/practices\/[^/]+\.mdx?$/i,
  /^docs\/playbooks\/[^/]+\.mdx?$/i,
];

/**
 * GitHub's recursive tree API truncates very large repositories, and this module is only handed the
 * resulting `tree` — not the flag. Until the call site passes `truncated` explicitly (the seam in
 * `extractPracticeShape`'s options), a tree at or above this size is treated as POSSIBLY truncated, so
 * a missing path from such a repo yields no verdict rather than a false "removed". Set well below
 * either GitHub cap (100 000 entries / 7 MB) and far above any real repository's file count.
 */
const TREE_TRUNCATION_PROXY = 60_000;

function isCensusPath(path: string): boolean {
  const p = path.toLowerCase();
  if (CENSUS_FIXED_PATHS.includes(p)) return true;
  if (CENSUS_EXTRA_RULES.some((re) => re.test(path))) return true;
  return OUTLINE_RULES.some((r) => r.re.test(path)) || LAYOUT_RULES.some((r) => r.re.test(path));
}

const norm = (p: string) => p.toLowerCase();

/**
 * MOONSHOT #33 — the body-free artifact census. One row per practice-artifact blob in the tree, in
 * tree order, capped at MAX_CENSUS.
 *
 * Digests use the repo's canonical `contentDigest` (`sha256-n1:<hex>` over LF-normalized text), so a
 * Windows checkout's line endings never read as a changed file. `outlineHash` is taken over
 * `outlineOf`'s output, which means it inherits the fenced-block skip: a `#` inside a ``` block can
 * no more reach an outline hash than it can reach an outline.
 */
export function censusArtifacts(tree: RepoFile[], files: FetchedFile[]): CensusArtifact[] {
  const byPath = new Map(files.map((f) => [norm(f.path), f.content]));
  const out: CensusArtifact[] = [];
  for (const t of tree) {
    if (t.type !== "blob" || !isCensusPath(t.path)) continue;
    const content = byPath.get(norm(t.path));
    if (content === undefined) {
      // In the tree, body outside the fetch budget. UNKNOWN — two explicit nulls, never a zero-hash.
      out.push({ path: t.path, bodyHash: null, outlineHash: null });
    } else {
      const outline = outlineOf(content);
      out.push({
        path: t.path,
        bodyHash: contentDigest(content),
        // A file with no headings (a workflow yaml, a stub) has no outline to compare, so the
        // cosmetic-edit allowance simply does not apply to it — null, not a hash of "".
        outlineHash: outline.length > 0 ? contentDigest(outline.join("\n")) : null,
      });
    }
    if (out.length >= MAX_CENSUS) break;
  }
  return out;
}

/**
 * Extract a repo's practice shapes from the scan snapshot. Pure.
 *
 * `files` carries the ingest sample's CONTENT (bounded by the fetch budget), `tree` the full path
 * listing. Outline rules need content and therefore only fire for files the sample actually pulled —
 * a guidance file outside the budget yields no outline rather than a guessed one. Layout rules need
 * only the tree, so they always fire.
 */
export function extractPracticeShape(
  tree: RepoFile[],
  files: FetchedFile[],
  /**
   * MOONSHOT #33. `truncated` is GitHub's own flag off `RepoSnapshot.truncated`; when the caller does
   * not pass it the census falls back to TREE_TRUNCATION_PROXY. Optional so the existing call site in
   * `scan-compose.ts` (another lane's file this wave) compiles unchanged.
   */
  opts: { truncated?: boolean } = {},
): RepoPracticeShape {
  const entries: ShapeEntry[] = [];
  const perPractice = new Map<string, number>();
  const take = (id: string): boolean => {
    const n = perPractice.get(id) ?? 0;
    if (n >= MAX_FILES_PER_PRACTICE) return false;
    perPractice.set(id, n + 1);
    return true;
  };

  // Outlines, in tree order so the extraction is deterministic across scans of the same commit.
  const byPath = new Map(files.map((f) => [norm(f.path), f.content]));
  for (const rule of OUTLINE_RULES) {
    const matches = tree
      .filter((t) => t.type === "blob" && rule.re.test(t.path))
      .sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
    for (const t of matches) {
      const content = byPath.get(norm(t.path));
      if (!content) continue;
      const outline = outlineOf(content);
      // A file with no headings has no shape to teach. Recording an empty outline would let a stub
      // count as an exemplar's structure.
      if (outline.length === 0) continue;
      if (!take(rule.practiceId)) break;
      entries.push({ practiceId: rule.practiceId, path: t.path, outline, layout: [] });
    }
  }

  // Layouts.
  for (const rule of LAYOUT_RULES) {
    const paths = tree
      .filter((t) => t.type === "blob" && rule.re.test(t.path))
      .map((t) => t.path)
      .sort()
      .slice(0, MAX_PATHS);
    if (paths.length === 0) continue;
    if (!take(rule.practiceId)) continue;
    entries.push({ practiceId: rule.practiceId, path: "", outline: [], layout: paths });
  }

  return {
    version: "2",
    entries,
    artifacts: censusArtifacts(tree, files),
    truncated: opts.truncated ?? tree.length >= TREE_TRUNCATION_PROXY,
  };
}

/**
 * Defensive parse of a persisted blob. A malformed shape degrades to "none", never throws.
 *
 * BACK-COMPATIBLE ACROSS THE CENSUS (#33): a stored `"1"` blob has no `artifacts`, and the field stays
 * ABSENT rather than becoming `[]`. That distinction is the whole honesty of the reconciler — an empty
 * census asserts "none of these files exist", which for a pre-census scan is false.
 */
export function parsePracticeShape(json: string | null | undefined): RepoPracticeShape | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as RepoPracticeShape;
    if (!v || !Array.isArray(v.entries)) return null;
    const census = Array.isArray(v.artifacts)
      ? v.artifacts
          .filter((a): a is CensusArtifact => !!a && typeof a.path === "string")
          .map((a) => ({
            path: a.path,
            bodyHash: typeof a.bodyHash === "string" ? a.bodyHash : null,
            outlineHash: typeof a.outlineHash === "string" ? a.outlineHash : null,
          }))
          .slice(0, MAX_CENSUS)
      : null;
    return {
      version: census ? "2" : "1",
      ...(census ? { artifacts: census, truncated: v.truncated === true } : {}),
      entries: v.entries
        .filter((e) => e && typeof e.practiceId === "string")
        .map((e) => ({
          practiceId: e.practiceId,
          path: typeof e.path === "string" ? e.path : "",
          outline: Array.isArray(e.outline) ? e.outline.filter((x): x is string => typeof x === "string") : [],
          layout: Array.isArray(e.layout) ? e.layout.filter((x): x is string => typeof x === "string") : [],
        })),
    };
  } catch {
    return null;
  }
}
