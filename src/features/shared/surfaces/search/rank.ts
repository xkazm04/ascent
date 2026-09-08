// ranking-and-excerpts: one written-down score (length-normalized term frequency per field, field
// weights from the index schema, rarity), a TOTAL order (score, then recency, then id — never the
// engine's residual order), and excerpts windowed on the densest match neighbourhood with marks derived
// from what the engine matched, composed as text segments so content is neutralized before it is
// marked. Scores never render; bands do. No React.

import type { Repo } from "./fixtures";
import { DOC_FIELDS, FIELD_WEIGHT, type Doc, type Exec, type Hit } from "./search";

/** The combination rule, in one place, with the reason each signal earns weight. */
export const SIGNALS = [
  { signal: "field weight", value: "name ×3 · owner ×1.5 · description ×1", why: "a match in the name is the product's judgment of where meaning concentrates" },
  { signal: "term frequency", value: "tf / (tf + 1.2 · len/avg)", why: "saturating, length-normalized: a long description does not win by repetition" },
  { signal: "rarity", value: "ln(1 + N/df)", why: "a term half the corpus carries says little; a rare one says where to look" },
  { signal: "recency", value: "tiebreak #1", why: "newer wins only at equal score — a prior, never a substitute for the query" },
  { signal: "identity", value: "tiebreak #2", why: "the final key is unique, so two runs of one query never disagree" },
] as const;

const K = 1.2;

export function score(hit: Hit, doc: Doc, exec: Extract<Exec, { kind: "ok" }>, N: number): number {
  let s = 0;
  const norm = K * (doc.len / exec.avgLen);
  for (const f of DOC_FIELDS) {
    const tf = hit.tf[f];
    if (tf > 0) s += FIELD_WEIGHT[f] * (tf / (tf + norm));
  }
  let rarity = 0;
  for (const t of hit.matched) rarity += Math.log(1 + N / Math.max(1, exec.df.get(t) ?? 1));
  return s * (1 + rarity);
}

export type Ranked = { repo: Repo; hit: Hit; score: number };
export type Sort = "relevance" | "recent";

/** Score desc, updatedAt desc, id asc — a total order. `sort: "recent"` keeps the same tail. */
export function rankHits(exec: Exec, docs: Map<string, Doc>, repos: Map<string, Repo>, sort: Sort): Ranked[] {
  if (exec.kind !== "ok") return [];
  const N = exec.searched;
  const out: Ranked[] = [];
  for (const hit of exec.hits.values()) {
    const repo = repos.get(hit.id);
    const doc = docs.get(hit.id);
    if (!repo || !doc) continue; // a ghost: the index knows an id the source no longer has (IndexPanel counts these)
    out.push({ repo, hit, score: score(hit, doc, exec, N) });
  }
  out.sort((a, b) => (sort === "relevance" ? b.score - a.score : 0) || b.repo.updatedAt - a.repo.updatedAt || (a.repo.id < b.repo.id ? -1 : 1));
  return out;
}

/** Hits whose id resolves to no source row: the drift the gate must see. */
export function ghostIds(exec: Exec, repos: Map<string, Repo>): string[] {
  return exec.kind === "ok" ? [...exec.hits.keys()].filter((id) => !repos.has(id)) : [];
}

/** The coarse bands the surface renders instead of numbers. */
export function band(rank: number, s: number, top: number): "best match" | "also matched" | "listed" {
  if (s <= 0) return "listed";
  return rank === 0 || s >= top * 0.8 ? "best match" : "also matched";
}

export type Segment = { text: string; mark: boolean };
export type Excerpt = { segments: Segment[]; leading: boolean; trailing: boolean };

/**
 * Window `original` around the densest cluster of `matched` (already folded — the engine's own tokens,
 * prefix-expanded where the ladder expanded them). Positions are found in the folded twin and applied
 * to the original by offset, which holds because folding here is length-preserving for the fixtures.
 */
export function excerpt(original: string, folded: string, matched: Iterable<string>, width = 88): Excerpt {
  const spans: [number, number][] = [];
  if (folded.length === original.length) {
    for (const m of matched) {
      if (!m) continue;
      let at = folded.indexOf(m);
      while (at >= 0) {
        spans.push([at, at + m.length]);
        at = folded.indexOf(m, at + m.length);
      }
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  if (original.length <= width) return { segments: mark(original, spans, 0, original.length), leading: false, trailing: false };
  let bestStart = 0;
  let best = -1;
  const seeds: [number, number][] = spans.length ? spans : [[0, 0]];
  for (const [s] of seeds) {
    const start = Math.max(0, Math.min(s - 20, original.length - width));
    const n = spans.filter(([a, b]) => a >= start && b <= start + width).length;
    if (n > best) (best = n), (bestStart = start);
  }
  const end = Math.min(original.length, bestStart + width);
  return { segments: mark(original, spans, bestStart, end), leading: bestStart > 0, trailing: end < original.length };
}

function mark(text: string, spans: [number, number][], from: number, to: number): Segment[] {
  const out: Segment[] = [];
  let cursor = from;
  for (const [a, b] of spans) {
    if (a < cursor || b > to) continue;
    if (a > cursor) out.push({ text: text.slice(cursor, a), mark: false });
    out.push({ text: text.slice(a, b), mark: true });
    cursor = b;
  }
  if (cursor < to) out.push({ text: text.slice(cursor, to), mark: false });
  return out;
}

/** What the common naive highlighter marks: the raw typed words re-found as whole words in the display text. */
export function naiveMarks(original: string, rawWords: string[]): number {
  let n = 0;
  for (const w of rawWords) n += (original.match(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")) ?? []).length;
  return n;
}
