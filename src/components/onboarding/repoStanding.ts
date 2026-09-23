// first-run-onboarding-wizard#B: the select step decides with each repo's standing in view. Pure
// derivations over the listing, so the chip, the selection mix, the recurring-cost netting and the
// default selection all read the SAME predicate for "already covered".
//
// "Covered" means a LIVE score exists. A preview (the deterministic mock) is not covered: its live
// scan is still owed, and a live rescan of the same commit is not a refunded no-op (persistScanReport's
// dedup is engine-aware and upgrades the mock row in place). So a preview-scanned repo is never
// labelled "unchanged, free" and never loses its default slot to the unscanned-first rule.

import type { OrgRepo, RepoStanding } from "@/components/onboarding/types";
import type { ScanRow } from "@/components/onboarding/OnboardingScanRow";
import type { RunPlan } from "@/components/onboarding/OnboardingFlow.model";
import { IMPORT_WATCH_SCHEDULE } from "@/components/onboarding/importScan";
import type { RepoState } from "@/lib/db";

/** Read the /api/app/repos row's `state` (RepoState) into a standing; null/absent state = null. A
 *  state that does not say which engine scored it is treated as a preview, so an unknown engine can
 *  never be advertised as a free no-op rescan. */
export function standingFromWire(state: Partial<RepoState> | null | undefined): RepoStanding | null {
  if (!state || typeof state !== "object") return null;
  return {
    level: typeof state.level === "string" ? state.level : null,
    overall: typeof state.overall === "number" ? state.overall : null,
    watched: state.watched === true,
    schedule: typeof state.scanSchedule === "string" ? state.scanSchedule : "off",
    scannedAt: typeof state.scannedAt === "string" ? state.scannedAt : null,
    preview: state.preview !== false,
  };
}

/** A live score exists for this repo. */
export function isCovered(standing: RepoStanding | null | undefined): boolean {
  return standing != null && standing.level != null && !standing.preview;
}

/** The row chip. Never claims "unchanged" (or free) unless both timestamps are known and the score is live. */
export function standingLabel(standing: RepoStanding | null, pushedAt: string | null): string {
  if (!standing || standing.level == null) return "not scanned yet";
  const head = standing.overall != null ? `${standing.level} · ${standing.overall}` : standing.level;
  if (standing.preview) return `${head} · preview estimate: the live scan has not run`;
  if (!pushedAt || !standing.scannedAt) return head;
  return Date.parse(pushedAt) > Date.parse(standing.scannedAt)
    ? `${head} · pushed since last scan`
    : `${head} · unchanged: a rescan returns the same score, free`;
}

/** Whether this listing carries standing at all (the App path does; the public listing does not). */
export function hasStanding(repos: readonly OrgRepo[]): boolean {
  return repos.some((r) => r.standing !== undefined);
}

/** How many selected repos are new coverage vs rescans of a live score. Null when the listing
 *  carries no standing, so the public-handle path renders no mix line. */
export function selectionMix(
  selected: ReadonlySet<string>,
  repos: readonly OrgRepo[],
): { fresh: number; rescans: number } | null {
  if (!hasStanding(repos)) return null;
  let fresh = 0;
  let rescans = 0;
  for (const r of repos) {
    if (!selected.has(r.fullName)) continue;
    if (isCovered(r.standing)) rescans++;
    else fresh++;
  }
  return { fresh, rescans };
}

/** Selected repos already watched on `schedule`: committing them to it adds no recurring draw. This
 *  reads the schedule, not the engine, so a preview-scored repo on the weekly autoscan still counts
 *  (the draw exists today either way). */
export function alreadyScheduled(selected: ReadonlySet<string>, repos: readonly OrgRepo[], schedule: string): number {
  let n = 0;
  for (const r of repos) {
    if (selected.has(r.fullName) && r.standing?.watched && r.standing.schedule === schedule) n++;
  }
  return n;
}

/** The standings a finished run establishes, keyed by fullName: every row that came back SCORED. A run
 *  with no recorded plan is taken as a preview (the safe reading: never advertise a free rescan the
 *  code cannot back). Watch/schedule follow the plan when it watched, else the repo's prior standing. */
export function overlayFromRun(
  rows: Readonly<Record<string, ScanRow>>,
  plan: Pick<RunPlan, "mock" | "watch" | "schedule"> | null,
  repos: readonly OrgRepo[],
  at: string,
): Record<string, RepoStanding> {
  const out: Record<string, RepoStanding> = {};
  for (const row of Object.values(rows)) {
    if (!row.level || row.error || row.skipped) continue;
    const prior = repos.find((r) => r.fullName === row.repo)?.standing ?? null;
    out[row.repo] = {
      level: row.level,
      overall: row.overall ?? null,
      watched: plan?.watch ? true : (prior?.watched ?? false),
      schedule: plan?.watch ? (plan.schedule ?? IMPORT_WATCH_SCHEDULE) : (prior?.schedule ?? "off"),
      scannedAt: at,
      preview: plan ? plan.mock : true,
    };
  }
  return out;
}

/** Lay the session's run overlay over a fresh listing. The overlay wins unless the listing already
 *  carries a scan at least as recent (the server's state has caught up, or moved on). */
export function applyRunOverlay(list: OrgRepo[], overlay: Readonly<Record<string, RepoStanding>>): OrgRepo[] {
  return list.map((r) => {
    const o = overlay[r.fullName];
    if (!o) return r;
    const wireAt = r.standing?.scannedAt ? Date.parse(r.standing.scannedAt) : Number.NEGATIVE_INFINITY;
    return wireAt >= Date.parse(o.scannedAt ?? "") ? r : { ...r, standing: o };
  });
}
