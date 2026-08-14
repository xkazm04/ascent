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

/** Caps. A shape is a skeleton, not a copy — these bound both the blob and the leak surface. */
const MAX_HEADINGS = 24;
const MAX_HEADING_CHARS = 90;
const MAX_PATHS = 20;
const MAX_FILES_PER_PRACTICE = 2;

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

export interface RepoPracticeShape {
  version: "1";
  entries: ShapeEntry[];
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

const norm = (p: string) => p.toLowerCase();

/**
 * Extract a repo's practice shapes from the scan snapshot. Pure.
 *
 * `files` carries the ingest sample's CONTENT (bounded by the fetch budget), `tree` the full path
 * listing. Outline rules need content and therefore only fire for files the sample actually pulled —
 * a guidance file outside the budget yields no outline rather than a guessed one. Layout rules need
 * only the tree, so they always fire.
 */
export function extractPracticeShape(tree: RepoFile[], files: FetchedFile[]): RepoPracticeShape {
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

  return { version: "1", entries };
}

/** Defensive parse of a persisted blob. A malformed shape degrades to "none", never throws. */
export function parsePracticeShape(json: string | null | undefined): RepoPracticeShape | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as RepoPracticeShape;
    if (!v || !Array.isArray(v.entries)) return null;
    return {
      version: "1",
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
