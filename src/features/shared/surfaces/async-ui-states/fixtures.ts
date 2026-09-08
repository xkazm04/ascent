// Deterministic fixtures for the async-ui-states scene. Seeded (mulberry32), so every reader and every
// screenshot sees the same repositories, follow-ups and alerts; no Math.random, no Date.now. Nothing
// here is an Ascent org — the scene says so on screen. No React.

import type { SurfaceVolume } from "@/lib/org/surface-catalog";

export type Repo = { id: string; label: string; score: number; level: number };
export type Followup = { id: string; title: string; repo: string };
export type Alert = { id: string; label: string; severity: "warn" | "danger" };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["alloy", "basalt", "cirrus", "delta", "ember", "fathom", "granite", "harbor", "isobar", "juniper", "kestrel", "lumen"];

/** The repository universe the search runs over: `volume` rows with system-of-record ids. */
export function repoRows(volume: SurfaceVolume, seed = 11): Repo[] {
  const rnd = mulberry32(seed);
  const out: Repo[] = [];
  for (let i = 0; i < volume; i++) {
    const score = Math.round(rnd() * 70 + 25);
    out.push({ id: `repo-${i + 1}`, label: `${WORDS[i % WORDS.length]}-${String(i + 1).padStart(2, "0")}`, score, level: Math.min(5, Math.max(1, Math.ceil(score / 20))) });
  }
  return out;
}

export type Sort = "name" | "score";
export const PAGE_SIZE = 6;

/** The query the fixture "server" answers: filter (identifying), then sort + page (windowing). */
export function queryRepos(universe: Repo[], q: { term: string; page: number; sort: Sort }): { rows: Repo[]; total: number } {
  const t = q.term.trim().toLowerCase();
  const matched = t ? universe.filter((r) => r.label.includes(t)) : universe;
  const sorted = q.sort === "score" ? [...matched].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)) : matched;
  const start = (q.page - 1) * PAGE_SIZE;
  return { rows: sorted.slice(start, start + PAGE_SIZE), total: sorted.length };
}

/** A refresh: the same identities re-delivered with drifted scores (never new ids on a plain refresh). */
export function driftRepos(rows: Repo[], nonce: number): Repo[] {
  const rnd = mulberry32(300 + nonce);
  return rows.map((r) => ({ ...r, score: Math.min(99, Math.max(5, Math.round(r.score + (rnd() - 0.5) * 6))) }));
}

/** Suggested search terms: two that match, one that matches nothing (the honest no-match empty). */
export const TERMS = ["", "al", "ke", "zz"] as const;

/** The review queue for the busy-state region: three items, three independent operations. */
export const QUEUE: readonly Followup[] = [
  { id: "fu-1", title: "Add an AGENTS.md at the root", repo: "alloy-01" },
  { id: "fu-2", title: "Pin the CI runner image", repo: "basalt-02" },
  { id: "fu-3", title: "Declare the LLM provider in the manifest", repo: "cirrus-03" },
];

/** The fictional worlds the empty-state region can settle into. `raw` is the unfiltered count. */
export type EmptyWorld = "first-run" | "prerequisite" | "no-match" | "permission" | "drained";
type World = { id: EmptyWorld; raw: number; filtered: number; label: string };
/** Non-empty by type: the panel falls back to the first world when the picked id is unknown. */
export const WORLDS: readonly [World, ...World[]] = [
  { id: "first-run", raw: 0, filtered: 0, label: "nothing exists yet" },
  { id: "prerequisite", raw: 0, filtered: 0, label: "app not connected" },
  { id: "no-match", raw: 40, filtered: 0, label: "filters exclude all 40" },
  { id: "permission", raw: 12, filtered: 0, label: "hidden at this role" },
  { id: "drained", raw: 0, filtered: 0, label: "queue drained" },
];

export function alertRows(seed = 5): Alert[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: 4 }, (_, i) => ({
    id: `alert-${i + 1}`,
    label: `${WORDS[(i * 3) % WORDS.length]}-${String(i * 3 + 1).padStart(2, "0")} dropped below L${2 + (i % 2)}`,
    severity: rnd() > 0.5 ? "danger" : "warn",
  }));
}
