// What a map card says, and offers, when its org scan ends (pure; no React, no db).
//
// The launch map used to tally `repo` frames into two integers and fall through to an empty-watchlist
// sentence, so an in-band refusal (out of credits, a server failure) and a budget-stopped remainder
// all read as "No watched repos to scan". This answer is derived from the SAME roster the dashboard's
// "Scan all watched" folds (scanRunRosterModel: foldStreamFrame / foldQueueSnapshot / rosterGroups),
// plus the two things the roster deliberately does not hold: the stream's in-band `error` text and its
// `queued` remainder. One rule, one fold, every consumer.
//
// Named *Model.ts beside the other pure launch modules; a test pins every branch.

import {
  retryScope,
  rosterGroups,
  type RosterAction,
  type RosterGroup,
  type ScanRunRoster,
} from "@/components/shared/scan/scanRunRosterModel";

/** The one sentence kept for a run that genuinely saw nothing: no frame scored, skipped or failed. */
export const EMPTY_WATCHLIST_TEXT = "No watched repos to scan. Open the org and watch some repos first.";

export interface FleetQueued {
  runId: string;
  pending: number;
  total: number;
  /** The follow hit its ceiling: `pending` is the last known count, no longer updating. */
  stopped?: boolean;
}

export type FleetScanOutcomeKind = "credits" | "failed" | "queued" | "partial" | "empty" | "scored";

export interface FleetScanOutcome {
  kind: FleetScanOutcomeKind;
  /** The card's sentence. Empty for a clean, fully-scored run (the stars already say it). */
  message: string;
  /** Set only for a refusal or failure; a queued tail or a partial run is not an error. */
  error?: string;
  /** The ONE remedy the card offers (the first group's, or the refusal's own). */
  action?: RosterAction;
  groups: RosterGroup[];
  scored: number;
  pending?: number;
  /** Exactly the failures, for a retry through the ordinary scoped POST /api/org/scan. */
  retryScope: { repos: string[] };
}

const plural = (n: number) => (n === 1 ? "repo" : "repos");
const CREDITS: RosterAction = { kind: "credits", href: "/pricing" };
/** The route's credit refusal (route.ts: "Out of scan credits: ...") and the 402 gate's wording. */
const isCreditText = (text: string) => /scan credits/i.test(text);

/** A refusal BEFORE the stream opened (non-2xx JSON body), or a body-less response. */
export function refusedOutcome(error: string | null | undefined, status: number, code?: string): FleetScanOutcome {
  const message = error?.trim() || `Scan failed (${status}).`;
  const credits = status === 402 || code === "insufficient_credits" || isCreditText(message);
  return { kind: credits ? "credits" : "failed", message, error: message, action: credits ? CREDITS : undefined, groups: [], scored: 0, retryScope: { repos: [] } };
}

/** The end of one org scan run, as a card sentence plus its one remedy. */
export function fleetScanOutcome(
  org: string,
  roster: ScanRunRoster,
  inBandError: string | null,
  queued: FleetQueued | null,
): FleetScanOutcome {
  const groups = rosterGroups(roster, org);
  const scored = roster.scored.length;
  const base = { groups, scored, retryScope: retryScope(roster) };
  const firstAction = groups.find((g) => g.action)?.action;
  const summary = groups.map((g) => g.title).join("; ");

  if (inBandError) {
    const credits = isCreditText(inBandError);
    return { ...base, kind: credits ? "credits" : "failed", message: inBandError, error: inBandError, action: credits ? CREDITS : firstAction };
  }
  if (queued && queued.pending > 0) {
    const tail = queued.stopped ? "stopped checking; it may still be running" : "finishing in the background";
    const lead = scored > 0 ? `${scored} scored. ` : "";
    const message = `${lead}${queued.pending} of ${queued.total} ${plural(queued.total)} queued, ${tail}.${summary ? ` ${summary}.` : ""}`;
    return { ...base, kind: "queued", message, action: firstAction, pending: queued.pending };
  }
  if (groups.length > 0) {
    return { ...base, kind: "partial", message: `Scan finished: ${scored} scored. ${summary}.`, action: firstAction };
  }
  // A drained queue is work that ran (its rows may simply not have been named by the poll), never
  // an empty watchlist.
  if (queued) return { ...base, kind: "scored", message: `Queued scans finished: ${queued.total} ${plural(queued.total)} in this run.` };
  if (scored === 0) return { ...base, kind: "empty", message: EMPTY_WATCHLIST_TEXT };
  return { ...base, kind: "scored", message: "" };
}
