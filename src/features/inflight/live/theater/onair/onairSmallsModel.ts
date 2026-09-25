// THE SMALL MONITORS — every repo of the fleet that is not on a lane monitor, with one state word.
//
// The fleet is what the pulse names: the runner's repos, the repos waiting for a slot, every lane,
// and every repo in the latest events — in that order, deduplicated. The state is the most urgent
// true thing: held by the runner or its own breaker, a plan that needs a person, just landed (dated
// on the server's clock), a lane at work that the big monitors had no room for, waiting, resting.

import type { LanePulse, LoopPulse } from "@/lib/local/runner-types";
import { fmtClock, repoShort, toMs } from "../theaterFormat";
import { lastTouched } from "../theaterHeaderModel";
import { planRepos } from "./onairBlank";
import { fmtHms, PAUSE_WORDS, REPO_PAUSE_WORDS } from "./onairFormat";
import { JUST_LANDED_MS } from "./onairLaneModel";
import { phaseShort } from "./onairStages";

export interface SmallItem {
  repo: string;
  name: string;
  tone: "grey" | "amber" | "green";
  state: string;
  sub: string;
}

export function fleetRepos(p: LoopPulse): string[] {
  const all = [...(p.runner?.repos.map((r) => r.repo) ?? []), ...p.waiting, ...p.lanes.map((l) => l.repo), ...p.latest.map((e) => e.repo)];
  return [...new Set(all)];
}

function lastLandings(p: LoopPulse): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of p.latest) {
    const at = toMs(e.at);
    if (e.kind === "landed" && at != null && at > (out.get(e.repo) ?? -Infinity)) out.set(e.repo, at);
  }
  return out;
}

const untilWords = (iso: string | null) => (iso ? `until ${fmtClock(iso)}` : "until resumed");

function itemFor(repo: string, p: LoopPulse, lane: LanePulse | undefined, land: number | undefined, plan: string | undefined): SmallItem {
  const base: SmallItem = { repo, name: repoShort(repo), tone: "grey", state: "RESTING", sub: land != null ? `landed ${fmtHms(land)}` : "no landing yet" };
  const r = p.runner;
  const pulseMs = toMs(p.at) ?? 0;
  if (r?.phase === "paused") return { ...base, tone: "amber", state: "HELD", sub: `${PAUSE_WORDS[r.pausedReason ?? ""] ?? "a breaker fired"} · ${untilWords(r.pausedUntil)}` };
  const own = r?.repos.find((x) => x.repo === repo);
  if (own?.paused) return { ...base, tone: "amber", state: "HELD", sub: `${REPO_PAUSE_WORDS[own.paused] ?? own.paused} · ${untilWords(own.pausedUntil)}` };
  if (!r) return { ...base, state: "NO RUNNER" };
  if (plan) return { ...base, tone: "amber", state: "PLAN NEEDS YOU", sub: plan.replace(/^[^:]+:\s*/, "") };
  if (land != null && pulseMs - land >= 0 && pulseMs - land <= JUST_LANDED_MS) return { ...base, tone: "green", state: "JUST LANDED" };
  if (lane) return { ...base, state: phaseShort(lane.phase), sub: lastTouched(lane) ?? "no file yet" };
  if (p.waiting.includes(repo)) return { ...base, state: "WAITS FOR A SLOT" };
  return base;
}

/** The small monitors, and how many columns their row wants (one row up to eight, then two rows). */
export function smallItems(p: LoopPulse | null, onMonitor: ReadonlySet<string>): { items: SmallItem[]; cols: number } {
  if (!p) return { items: [], cols: 4 };
  const lands = lastLandings(p);
  const plans = planRepos(p);
  const items = fleetRepos(p)
    .filter((repo) => !onMonitor.has(repo))
    .map((repo) => itemFor(repo, p, p.lanes.find((l) => l.repo === repo), lands.get(repo), plans.get(repo)));
  const n = items.length;
  return { items, cols: n <= 8 ? Math.max(n, 4) : Math.ceil(n / 2) };
}
