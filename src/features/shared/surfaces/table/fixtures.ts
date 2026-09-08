// Deterministic fixtures for the table scene: a fictional fleet of repositories, seeded (mulberry32)
// so every reader and every screenshot sees the same rows at the same volume. No Math.random, no
// Date.now — "scanned" is a day-count, never a clock read. No React.

import type { SurfaceVolume } from "@/lib/org/surface-catalog";

export type RepoStatus = "fail" | "warn" | "queued" | "ok";

/** One fleet row. Identity (`id`) is minted here, once — the invariant every technique stands on. */
export type Repo = {
  id: string;
  name: string;
  /** Maturity level 1–5, or null when the repo has never been scanned. */
  level: number | null;
  /** 0–100, or null with the level. Absent values are what the sort's "one declared home" rule is for. */
  score: number | null;
  commits: number;
  status: RepoStatus;
  /** Days since the last scan, or null when never scanned. */
  scannedDaysAgo: number | null;
};

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

const A = ["alloy", "basalt", "cirrus", "delta", "ember", "fathom", "granite", "harbor", "isobar", "juniper", "kestrel", "lumen", "moraine", "nimbus", "oxbow", "pumice"];
const B = ["api", "web", "infra", "docs", "cli", "sdk", "worker", "gateway", "ledger", "auth", "search", "billing"];
const STATUSES: readonly RepoStatus[] = ["ok", "ok", "ok", "warn", "warn", "queued", "fail"];

/** `volume` repositories with system-of-record identities (`r-<n>`), ~8% never scanned. */
export function makeRepos(volume: SurfaceVolume, seed = 11): Repo[] {
  const rnd = mulberry32(seed + volume);
  const out: Repo[] = [];
  for (let i = 0; i < volume; i++) {
    const scanned = rnd() > 0.08;
    const level = scanned ? 1 + Math.floor(rnd() * 5) : null;
    // Scores cluster inside the level band, so ties on level are common and the tiebreaker has work.
    const score = level === null ? null : Math.min(100, (level - 1) * 20 + Math.floor(rnd() * 21));
    out.push({
      id: `r-${String(i + 1).padStart(6, "0")}`,
      name: `${A[Math.floor(rnd() * A.length)]}-${B[Math.floor(rnd() * B.length)]}`,
      level,
      score,
      commits: Math.floor(rnd() * 400),
      status: STATUSES[Math.floor(rnd() * STATUSES.length)] ?? "ok",
      scannedDaysAgo: scanned ? Math.floor(rnd() * 90) : null,
    });
  }
  return out;
}

/**
 * A repository inserted while the user browses: it takes the maximum of every sortable value so it
 * lands at the head of any descending order — the mutation that shifts every offset page and leaves a
 * keyset boundary exactly where it was.
 */
export function insertedRepo(n: number): Repo {
  return { id: `new-${n}`, name: `zenith-arrival-${n}`, level: 5, score: 100, commits: 400 + n, status: "ok", scannedDaysAgo: 0 };
}

/** Rows per page — rarely below 25 for a dense work surface; one of a few sizes, never free-form. */
export const PAGE_SIZE = 25;
