// The "latest" rail's clustering — a VIEW over `pulse.latest`, never stored (`feed/event-clustering`).
//
// One busy repo landing five times in two minutes would otherwise own the whole one-line ticker. A
// cluster is a run of CONSECUTIVE events (feed order, newest first) with the same repo and kind, each
// within `CLUSTER_WINDOW_MS` of its neighbour. A failure or a rejection is never clustered away: the
// reader must not have to expand a calm-looking row to find a buried error.
//
// Identity: a cluster is keyed by its relation (repo + kind) AND its OLDEST member, which never changes
// as newer members join at the head — so a growing cluster updates in place instead of re-entering,
// and the rail's one-shot entrance (`motion/one-shot-guarding`) plays once per cluster.

import type { PulseEvent } from "@/lib/local/runner-types";
import { eventKey } from "./theaterPulseParse";
import { toMs } from "./theaterFormat";

export const CLUSTER_WINDOW_MS = 120_000;
const NEVER_CLUSTER: ReadonlySet<PulseEvent["kind"]> = new Set(["failed", "rejected"]);

export interface LatestCluster {
  /** repo | kind | the oldest member's key — stable while the cluster grows. */
  id: string;
  repo: string;
  kind: PulseEvent["kind"];
  count: number;
  /** The newest member's headline and instant: a live run sorts at its latest event. */
  headline: string;
  at: string;
  /** The oldest member's key — what the one-shot entrance guard checks. */
  anchorKey: string;
}

export function clusterLatest(events: readonly PulseEvent[], windowMs = CLUSTER_WINDOW_MS): LatestCluster[] {
  const out: LatestCluster[] = [];
  let oldestAt: number | null = null;
  for (const e of events) {
    const last = out[out.length - 1];
    const at = toMs(e.at);
    const joins =
      last !== undefined &&
      !NEVER_CLUSTER.has(e.kind) &&
      last.repo === e.repo &&
      last.kind === e.kind &&
      at != null &&
      oldestAt != null &&
      Math.abs(oldestAt - at) <= windowMs;
    if (joins) {
      last.count += 1;
      last.anchorKey = eventKey(e);
      last.id = `${e.repo}|${e.kind}|${last.anchorKey}`;
    } else {
      const key = eventKey(e);
      out.push({ id: `${e.repo}|${e.kind}|${key}`, repo: e.repo, kind: e.kind, count: 1, headline: e.headline, at: e.at, anchorKey: key });
    }
    oldestAt = at;
  }
  return out;
}

export type LatestTone = "good" | "attention" | "bad" | "info";

export function latestTone(kind: PulseEvent["kind"]): LatestTone {
  if (kind === "landed" || kind === "verified-close") return "good";
  if (kind === "plan-pending" || kind === "paused") return "attention";
  if (kind === "failed" || kind === "rejected") return "bad";
  return "info";
}
