// "SINCE YOU LAST LOOKED" — the ledger's delta briefing, derived PURELY from what the ledger already
// loaded (`session-resume/delta-briefings`): zero fetches of its own, so the card and the sections it
// links to are filters over the same rows and cannot disagree.
//
//   • ANCHOR — the viewer's `Membership.liveSeenAt`, snapshotted at render. Null (never looked, or no
//     per-user anchor) → the last 24 hours, and the card SAYS "in the last 24 hours".
//   • SELECTION — each class declares its predicate; survivors are ranked by CONSEQUENCE to the operator
//     (what waits for them, then what broke, then what was delivered, then ambient completion) and capped
//     at BRIEFING_CAP lines, the rest summarised as "…and N quieter changes" — never scrolled.
//   • COUNTS CARRY THEIR PREDICATE — every line's `predicate` is its tooltip. A count taken over the
//     chronicle's first page when older runs exist AFTER the anchor is a lower bound, and prints "N+".
//   • CURRENT STATE IS WORDED AS SUCH — plans awaiting approval and pauses still in force are not
//     changes since the anchor; they say "now".
//   • NO NEWS → null (no card, never "nothing happened"); A FAILED READ → `error`, never silence.

import { plural } from "./ledgerFormat";
import { LEDGER_ANCHOR, RUNNER_BRANCH, breakerWords, needsOperator } from "./ledgerModel";
import type {
  DriveStatus,
  LedgerRead,
  LoopDirectionRecord,
  LoopPlanRecord,
  LoopRunChronicleEntry,
} from "./ledgerTypes";

export const BRIEFING_CAP = 5;
export const FALLBACK_WINDOW_MS = 24 * 3_600_000;

export type BriefingLineId = "awaiting" | "breakers" | "paused-now" | "exhausted" | "closes" | "landed" | "directions-done" | "runs";

export interface BriefingLine {
  id: BriefingLineId;
  text: string;
  /** What the count counts — the line's tooltip. */
  predicate: string;
  /** The section that proves it. */
  href: string;
  /** A right-now count (awaiting you), not a change since the anchor. */
  current: boolean;
}

export type Briefing =
  | { kind: "error"; missing: LedgerRead[] }
  | { kind: "news"; window: string; lines: BriefingLine[]; overflow: BriefingLine[] };

export interface BriefingInput {
  now: string;
  seenAt: string | null;
  runs: readonly LoopRunChronicleEntry[] | null;
  /** The chronicle's first page was full — older runs exist or may exist. */
  runsHasMore: boolean;
  pending: readonly LoopPlanRecord[] | null;
  directions: readonly LoopDirectionRecord[] | null;
  /** The live runner (current pauses), and the newest continuous drive (its event ledger). */
  runner: DriveStatus | null;
  lastRunner: DriveStatus | null;
  failed: readonly LedgerRead[];
}

/** The reads a briefing is derived from. `lessons` is not one of them. */
const DERIVED_FROM: readonly LedgerRead[] = ["drives", "anchor", "runs", "plans", "directions"];

const a = (id: keyof typeof LEDGER_ANCHOR): string => `#${LEDGER_ANCHOR[id]}`;

export function deriveBriefing(input: BriefingInput): Briefing | null {
  const missing = DERIVED_FROM.filter((r) => input.failed.includes(r));
  if (input.runs == null && !missing.includes("runs")) missing.push("runs");
  if (input.pending == null && !missing.includes("plans")) missing.push("plans");
  if (input.directions == null && !missing.includes("directions")) missing.push("directions");
  const nowMs = Date.parse(input.now);
  if (missing.length > 0 || !Number.isFinite(nowMs) || !input.runs || !input.pending || !input.directions) {
    return { kind: "error", missing };
  }
  const seenMs = input.seenAt ? Date.parse(input.seenAt) : NaN;
  const anchored = Number.isFinite(seenMs);
  const anchor = anchored ? seenMs : nowMs - FALLBACK_WINDOW_MS;
  const after = (iso: string | null | undefined): boolean => iso != null && Date.parse(iso) > anchor;
  const since = anchored ? "since you last looked" : "in the last 24 hours";

  const runs = input.runs;
  const oldest = runs[runs.length - 1];
  // Runs are sequential per org, so once the oldest loaded run STARTED before the anchor, no unread run
  // can have finished after it. Otherwise the counts over this page are lower bounds.
  const bounded = input.runsHasMore && oldest != null && after(oldest.startedAt);
  const plus = bounded ? "+" : "";
  const bound = bounded ? ` Counted over the ${runs.length} most recent runs only — older runs were not read, so this is a lower bound.` : "";

  const lines: BriefingLine[] = [];
  const push = (l: BriefingLine) => lines.push(l);

  const waiting = input.pending.length;
  if (waiting > 0) {
    push({
      id: "awaiting",
      current: true,
      text: waiting === 1 ? "1 plan waits for your approval now" : `${waiting} plans wait for your approval now`,
      predicate: "Plans whose status is pending right now — a current count, not a change since you last looked.",
      href: a("needsYou"),
    });
  }

  const events = (input.lastRunner?.events ?? []).filter(
    (e) => (e.event === "paused" || e.event === "repo-paused") && e.reason !== "dry-backoff" && after(e.at),
  );
  if (events.length > 0) {
    push({
      id: "breakers",
      current: false,
      text: `${plural(events.length, "breaker")} tripped — ${[...new Set(events.map(breakerWords))].join("; ")}`,
      predicate: `Runner pause events (runner-wide, or one repository) recorded ${since}. A rest after dry runs is not a breaker. The runner keeps a bounded event log.`,
      href: a("needsYou"),
    });
  } else {
    const heldRepos = (input.runner?.repoState ?? []).filter(needsOperator).length;
    const runnerPaused = input.runner?.phase === "paused";
    if (runnerPaused || heldRepos > 0) {
      const parts = [runnerPaused ? "the runner is paused" : null, heldRepos > 0 ? `${plural(heldRepos, "repository", "repositories")} paused` : null];
      push({
        id: "paused-now",
        current: true,
        text: `Paused now: ${parts.filter(Boolean).join(", ")}`,
        predicate: "Pauses in force right now that only you can lift (a timed rest after dry runs is excluded) — a current state, not a change.",
        href: a("needsYou"),
      });
    }
  }

  const ended = (status: string) => input.directions!.filter((d) => d.status === status && after(d.endedAt)).length;
  const exhausted = ended("exhausted");
  if (exhausted > 0) {
    push({
      id: "exhausted",
      current: false,
      text: `${plural(exhausted, "direction")} ran out of budget`,
      predicate: `Directions that reached their cycle or spend budget ${since}.`,
      href: a("directions"),
    });
  }

  const finished = runs.filter((r) => after(r.endedAt));
  const closes = finished.reduce((n, r) => n + r.verifiedCloses, 0);
  if (closes > 0) {
    push({
      id: "closes",
      current: false,
      text: `${closes}${plus} verified ${closes === 1 && !plus ? "close" : "closes"}`,
      predicate: `Follow-ups the rescan adjudicated closed (the lanes' closedIds), summed over runs that finished ${since}. An agent's unconfirmed claim is not counted.${bound}`,
      href: a("chronicle"),
    });
  }

  const landed = runs.reduce((n, r) => n + r.landedAt.filter(after).length, 0);
  if (landed > 0) {
    push({
      id: "landed",
      current: false,
      text: `${landed}${plus} ${landed === 1 && !plus ? "lane" : "lanes"} landed on ${RUNNER_BRANCH}`,
      predicate: `Lanes whose verified work was delivered onto the runner branch ${since} (the lane's landedAt).${bound}`,
      href: a("runner"),
    });
  }

  const done = ended("done");
  if (done > 0) {
    push({
      id: "directions-done",
      current: false,
      text: `${plural(done, "direction")} finished`,
      predicate: `Directions marked done ${since}.`,
      href: a("directions"),
    });
  }

  if (finished.length > 0) {
    const errored = finished.filter((r) => r.phase === "error").length;
    push({
      id: "runs",
      current: false,
      text: `${finished.length}${plus} ${finished.length === 1 && !plus ? "run" : "runs"} finished${errored ? ` (${errored} errored)` : ""}`,
      predicate: `Runs that ended ${since}, in any phase.${bound}`,
      href: a("chronicle"),
    });
  }

  if (lines.length === 0) return null;
  return { kind: "news", window: since, lines: lines.slice(0, BRIEFING_CAP), overflow: lines.slice(BRIEFING_CAP) };
}
