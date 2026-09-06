// Deterministic fixtures for the feed scene: `volume` fictional occurrences spread over SPAN_DAYS,
// seeded (mulberry32) so every reader and every screenshot sees the same stream. The scene clock is a
// FIXED instant (SCENE_NOW) that only arrivals advance — no Date.now, no Math.random — so relative
// labels, day buckets and the retention horizon are reproducible. Bursts share one second on purpose:
// ties are the routine case reverse-chronology-semantics exists for. No React.

import type { SurfaceVolume } from "@/lib/org/surface-catalog";

export type Kind = "scan" | "level-up" | "security" | "followup" | "sync" | "scan-failed" | "member";

export type Occurrence = {
  /** System-of-record identity, minted at creation. */
  id: string;
  /** The authority's sequence: the tiebreaker of the total order. Never the renderer's. */
  seq: number;
  kind: Kind;
  actor: string;
  object: string;
  /** Event time — when it happened (the ordering key by default). */
  eventAt: number;
  /** Arrival time — when this store learned of it. */
  arrivedAt: number;
  /** In-flight rows are never history yet: the reaper skips them. */
  settled: boolean;
  /** A member outcome the cluster row must not average away. */
  warn: boolean;
};

/** The scene's "now" at mount: 2026-09-06 14:30 UTC. Fiction, frozen. */
export const SCENE_NOW = Date.UTC(2026, 8, 6, 14, 30, 0);
export const SPAN_DAYS = 120;
const MIN = 60_000;

const ACTORS = ["mira", "tomas", "lena", "ci", "bot-rescan"] as const;
const REPOS = ["acme/api", "acme/web", "acme/infra", "acme/mobile", "acme/docs", "acme/billing", "acme/edge", "acme/ml"] as const;
const SINGLE_KINDS: Kind[] = ["scan", "scan", "scan", "level-up", "security", "followup", "followup", "scan-failed", "member"];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const make = (seq: number, kind: Kind, actor: string, object: string, eventAt: number, lag: number, warn = false): Occurrence => ({
  id: `oc-${seq}`,
  seq,
  kind,
  actor,
  object,
  eventAt,
  arrivedAt: eventAt + lag,
  settled: true,
  warn,
});

/**
 * `volume` occurrences, newest first, seq descending. The average gap scales with the volume so every
 * volume spans the same 120 days (retention has something to reap at 50 rows and at 50,000). About one
 * run in eight is a sync burst: 5–40 rows by one bot, all stamped the same second.
 */
export function occurrencesFor(volume: SurfaceVolume): Occurrence[] {
  const rnd = mulberry32(volume);
  const avgGap = (SPAN_DAYS * 24 * 60 * MIN) / volume;
  const out: Occurrence[] = [];
  let seq = volume;
  let t = SCENE_NOW - 90_000;
  while (out.length < volume) {
    const room = volume - out.length;
    if (room > 1 && rnd() < 0.12) {
      const size = Math.min(room, 5 + Math.floor(rnd() * 36));
      const actor = rnd() < 0.6 ? "bot-sync" : "bot-rescan";
      for (let k = 0; k < size; k++) out.push(make(seq--, "sync", actor, REPOS[Math.floor(rnd() * REPOS.length)], t, Math.floor(rnd() * 20_000), rnd() < 0.06));
    } else {
      const kind = SINGLE_KINDS[Math.floor(rnd() * SINGLE_KINDS.length)];
      out.push(make(seq--, kind, ACTORS[Math.floor(rnd() * ACTORS.length)], REPOS[Math.floor(rnd() * REPOS.length)], t, Math.floor(rnd() * 20_000)));
    }
    t -= Math.round(avgGap * (0.3 + rnd() * 1.4));
  }
  // The newest row is a scan still running: in flight, so never eligible for the reaper.
  out[0] = { ...out[0], kind: "scan", settled: false, warn: false };
  return out;
}

/** The n-th live arrival, deterministic in `n`. `eventAt` backdates the event (a late arrival: it happened earlier, arrives now). */
export function arrivalAt(n: number, seq: number, now: number, opts: { eventAt?: number; sync?: boolean } = {}): Occurrence {
  const rnd = mulberry32(1000 + n);
  const kind: Kind = opts.sync ? "sync" : SINGLE_KINDS[Math.floor(rnd() * SINGLE_KINDS.length)];
  const actor = opts.sync ? "bot-sync" : ACTORS[Math.floor(rnd() * ACTORS.length)];
  const eventAt = opts.eventAt ?? now;
  const row = make(seq, kind, actor, REPOS[Math.floor(rnd() * REPOS.length)], eventAt, 0, opts.sync && rnd() < 0.1);
  return { ...row, arrivedAt: now };
}

/** How far the scene clock advances on the n-th arrival: 1–5 minutes, deterministic. */
export function advanceFor(n: number): number {
  return Math.round((1 + mulberry32(7000 + n)() * 4) * MIN);
}

const VERB: Record<Kind, string> = {
  scan: "scan finished",
  "level-up": "reached the next level",
  security: "security finding opened",
  followup: "follow-up closed",
  sync: "synced",
  "scan-failed": "scan FAILED",
  member: "joined the org",
};

export function textOf(o: Occurrence): string {
  if (!o.settled) return `${o.actor} started a scan of ${o.object}`;
  if (o.kind === "member") return `${o.actor} joined the org`;
  return `${o.actor} · ${VERB[o.kind]} · ${o.object}`;
}

/** Kinds that resist clustering: singular, high-consequence, acted on individually. */
export const NEVER_CLUSTER: readonly Kind[] = ["scan-failed", "security"];
