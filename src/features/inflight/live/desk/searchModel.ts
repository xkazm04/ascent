// The desk's search — rounds (#n), repos and arms, over what the page already holds. Pure: no fetch.
// Every whitespace-separated token must match; hits are grouped (Rounds, Repos, Arms) and capped.

import type { ArmRow } from "./armsModel";
import { seqRange } from "./armsModel";
import type { DeskRoute } from "./deskRoute";
import type { DeskRound } from "./roundsModel";
import { date, repoShort } from "./deskFormat";

export interface SearchHit {
  group: "Rounds" | "Repos" | "Arms";
  title: string;
  ctx: string;
  to: DeskRoute;
  hay: string;
}

export const SEARCH_MAX = 24;

export function searchIndex(rounds: readonly DeskRound[], arms: readonly ArmRow[]): SearchHit[] {
  const out: SearchHit[] = [];
  for (const r of [...rounds].reverse()) {
    out.push({
      group: "Rounds",
      title: `Round ${r.label}`,
      ctx: `${date(r.startMs)} · ${r.lanes.length} lanes · ${r.closes} closes`,
      to: { kind: "round", runId: r.id },
      hay: `${r.label} round ${r.repos.join(" ")}`.toLowerCase(),
    });
  }
  const repos = new Map<string, DeskRound>();
  for (const r of rounds) for (const repo of r.repos) repos.set(repo, r);
  for (const [repo, last] of [...repos.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const n = rounds.filter((r) => r.repos.includes(repo)).length;
    out.push({
      group: "Repos",
      title: repoShort(repo),
      ctx: `${repo} · ${n} rounds · last ${last.label}`,
      to: { kind: "round", runId: last.id },
      hay: `${repo} repo`.toLowerCase(),
    });
  }
  for (const a of arms) {
    out.push({
      group: "Arms",
      title: a.key,
      ctx: `${a.lanes} lanes · ${a.closes} closes ${seqRange(a)}`.trim(),
      to: { kind: "arm", key: a.key },
      hay: `${a.key} arm`.toLowerCase(),
    });
  }
  return out;
}

export function searchHits(index: readonly SearchHit[], query: string): SearchHit[] {
  const toks = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  return index.filter((x) => toks.every((t) => x.hay.includes(t) || x.title.toLowerCase().includes(t))).slice(0, SEARCH_MAX);
}
