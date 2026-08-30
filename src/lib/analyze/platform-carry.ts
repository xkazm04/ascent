// CARRYING a platform fold into a scan that could not observe one.
//
// The loop's rescans run from a worktree with `noAmbientToken` (src/lib/local/loop-lane.ts), so the
// GitHub-side folds in platform-signals.ts never apply: the same commit scores lower from inside the
// loop than a GitHub scan of it would. That is not a rounding difference. `green` demands L5 on
// EVERY dimension (maturity/green.ts), so three dimensions that can only ever be read at their
// file-scan floor are three dimensions the loop can drive at forever — a ceiling with no visible
// cause, which is the exact shape of failure the drive was built to refuse.
//
// The honest repair has two halves and this module is both:
//
//   CARRY. The last scan of that repo that DID observe the platform signals recorded what they were
//   worth (PlatformSignalRecord). A worktree rescan replays that record — the same points on the
//   same dimensions, with the same evidence lines — and stamps every one of them with where it came
//   from and how old it is. A carried credit is never presented as something this scan measured.
//
//   REFUSE. When no such scan exists, the fold cannot be reconstructed and D2/D3/D4 are simply not
//   measurable from a worktree. The record says `unavailable`, and the green verdict EXCLUDES those
//   dimensions rather than demanding an L5 the reading had no way to produce. Excluded is not the
//   same as passed: a repo whose every dimension is unmeasurable is not green (see green.ts).
//
// The staleness threshold is a disclosure, not a gate. A three-week-old App inventory is still the
// best evidence anyone has about a repo's installed tooling, and dropping it would swap a stated
// uncertainty for a silent understatement — so a stale fold still applies, and says so.

import type { CarriedSecurityInputs, DimensionId, DimensionSignals, PlatformSignalRecord } from "@/lib/types";

/**
 * The dimensions the platform folds can move — and the only ones anything here may exclude.
 *
 * Declared in this module rather than beside the folds themselves so it stays DEPENDENCY-FREE:
 * `platform-signals.ts` reaches for the GitHub clients and the claims rubric, and the attribution
 * rule (maturity/attribution.ts) that has to know which dimensions are foldable is client-safe by
 * contract. One declaration, imported both ways, rather than a second list that drifts.
 */
export const PLATFORM_FOLD_DIMS: readonly DimensionId[] = ["D2", "D3", "D4"];

/**
 * How old a carried observation may be before it is marked `stale`.
 *
 * Two weeks, from what the underlying signals actually are: an installed-App inventory and a
 * default-branch CI success rate. Both are org/settings-level facts that change on the order of
 * months, not days — but a fortnight is long enough for a team to add or remove a review App, so it
 * is the point past which "this was true when we looked" stops being a safe reading of "this is true".
 */
export const PLATFORM_FOLD_STALE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Age of the OBSERVATION (not of the carrying scan) in days, or null when it is unknowable. */
export function platformFoldAgeDays(record: PlatformSignalRecord | null | undefined, now: Date = new Date()): number | null {
  if (!record?.observedAt) return null;
  const at = Date.parse(record.observedAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, (now.getTime() - at) / DAY_MS);
}

/** Past the threshold. Unknown age is NOT stale — unknown is not a finding (same rule as elsewhere). */
export function isPlatformFoldStale(record: PlatformSignalRecord | null | undefined, now: Date = new Date()): boolean {
  const age = platformFoldAgeDays(record, now);
  return age != null && age > PLATFORM_FOLD_STALE_DAYS;
}

/** Compact age for a provenance line: `3d`, `20h`, `just now`. Empty when the age is unknown. */
export function platformFoldAge(record: PlatformSignalRecord | null | undefined, now: Date = new Date()): string {
  const age = platformFoldAgeDays(record, now);
  if (age == null) return "";
  if (age >= 1) return `${Math.round(age)}d old`;
  const hours = Math.round(age * 24);
  return hours >= 1 ? `${hours}h old` : "just now";
}

/** The `unavailable` reading: no token, no snapshot, nothing to say about D2/D3/D4. */
export function platformSignalsUnavailable(): PlatformSignalRecord {
  return { source: "unavailable", observedAt: null, dims: [] };
}

/**
 * The dimensions a consumer must NOT hold against the repo on this reading.
 *
 * Only `unavailable` produces any: an observed fold measured them, and a carried one reproduced a
 * measurement. `undefined` (a legacy row, a reconstructed snapshot) yields none — unknown provenance
 * is not evidence that a dimension was unmeasurable, and treating it as such would silently drop
 * three dimensions out of every historical green verdict.
 */
export function unmeasurablePlatformDims(record: PlatformSignalRecord | null | undefined): DimensionId[] {
  return record?.source === "unavailable" ? [...PLATFORM_FOLD_DIMS] : [];
}

/**
 * Replay a recorded fold onto a scan that could not observe one.
 *
 * Each carried evidence line keeps its original label and gains its provenance in the `detail`, so a
 * reader of the report sees the same claim the GitHub scan made AND where it was borrowed from.
 * A crashed detector is never decorated, exactly as the live folds refuse to (G3-08).
 */
export function carryPlatformFold(
  signals: DimensionSignals[],
  snapshot: { record: PlatformSignalRecord; scanId: string },
  now: Date = new Date(),
): { signals: DimensionSignals[]; record: PlatformSignalRecord } {
  const stale = isPlatformFoldStale(snapshot.record, now);
  const provenance = `platform signals from scan ${snapshot.scanId}, ${platformFoldAge(snapshot.record, now)}${stale ? " · STALE" : ""}`;
  const byDim = new Map(snapshot.record.dims.map((d) => [d.dimId as string, d]));

  const folded = signals.map((s) => {
    const fold = byDim.get(s.id);
    if (!fold || s.failed) return s;
    return {
      ...s,
      signalScore: Math.max(0, Math.min(100, s.signalScore + fold.points)),
      signals: [
        ...s.signals,
        ...fold.signals.map((sig) => ({
          ...sig,
          detail: sig.detail ? `${sig.detail} · ${provenance}` : provenance,
        })),
      ],
    };
  });

  return {
    signals: folded,
    record: {
      source: "carried",
      observedAt: snapshot.record.observedAt,
      fromScanId: snapshot.scanId,
      ...(stale ? { stale: true as const } : {}),
      dims: snapshot.record.dims,
      // The D9 battery's GitHub-side inputs ride along VERBATIM: scan-score-input re-runs the battery
      // over the worktree's files with this reading, which is the only carry that survives D9 being
      // replaced after the fold (see CarriedSecurityInputs).
      ...(snapshot.record.securityInputs ? { securityInputs: snapshot.record.securityInputs } : {}),
    },
  };
}

/**
 * What one end of a comparison could see of the D9 battery's GITHUB-SIDE inputs.
 *
 *   - `null`     — the end never recorded the question (a legacy row). Unknown, not "none".
 *   - `"github"` — observed live, or carried from an observed scan WITH its security inputs: the
 *                  battery ran over the same GitHub reading either way.
 *   - `"none"`   — declared local with nothing to carry, or carried from a record written before the
 *                  inputs were recorded: branch protection / installed Apps / org policy were blind.
 *
 * D9 is not in PLATFORM_FOLD_DIMS on purpose — its GitHub reading is not points on a dimension but
 * inputs to a battery — so `foldIsComparable` reads THIS for D9 instead of `foldPointsFor`.
 */
export type SecurityObservability = "github" | "none";
export function securityObservability(record: PlatformSignalRecord | null | undefined): SecurityObservability | null {
  if (!record) return null;
  if (record.source === "observed") return "github";
  if (record.source === "carried") return record.securityInputs ? "github" : "none";
  return "none";
}

/** The security inputs a worktree rescan should hand the D9 battery, or null when it has none. */
export function carriedSecurityInputs(record: PlatformSignalRecord | null | undefined): CarriedSecurityInputs | null {
  return record?.source === "carried" || record?.source === "observed" ? (record.securityInputs ?? null) : null;
}

/**
 * The one line a surface prints about a scan's platform provenance, or null when there is nothing to
 * disclose. An `observed` scan says nothing: reading GitHub is the ordinary case, and a chip on every
 * report is a chip nobody reads.
 */
export function platformFoldNote(record: PlatformSignalRecord | null | undefined, now: Date = new Date()): string | null {
  if (!record) return null;
  if (record.source === "unavailable") return `${PLATFORM_FOLD_DIMS.join("/")} not measurable locally`;
  if (record.source !== "carried") return null;
  const age = platformFoldAge(record, now);
  const from = record.fromScanId ? `scan ${record.fromScanId}` : "an earlier scan";
  return `platform signals from ${from}${age ? `, ${age}` : ""}${record.stale ? " · stale" : ""}`;
}

/** Narrow a persisted JSON blob back to a record. Anything unrecognisable reads as UNKNOWN, never as
 *  a shape with defaults — a manufactured `unavailable` would drop dimensions out of a verdict. */
export function parsePlatformSignals(raw: string | null | undefined): PlatformSignalRecord | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return undefined;
    const rec = v as Partial<PlatformSignalRecord>;
    if (rec.source !== "observed" && rec.source !== "carried" && rec.source !== "unavailable") return undefined;
    return {
      source: rec.source,
      observedAt: typeof rec.observedAt === "string" ? rec.observedAt : null,
      ...(typeof rec.fromScanId === "string" ? { fromScanId: rec.fromScanId } : {}),
      ...(rec.stale === true ? { stale: true as const } : {}),
      // Normalized, not merely filtered: `signals` is replayed with `.map` by carryPlatformFold, so a
      // row missing it would crash the very scan it is meant to enrich.
      dims: Array.isArray(rec.dims)
        ? rec.dims
            .filter((d) => d && typeof d.dimId === "string" && typeof d.points === "number")
            .map((d) => ({ dimId: d.dimId, points: d.points, signals: Array.isArray(d.signals) ? d.signals : [] }))
        : [],
      ...(rec.securityInputs && typeof rec.securityInputs === "object"
        ? {
            securityInputs: {
              governance: rec.securityInputs.governance ?? null,
              posture: rec.securityInputs.posture ?? null,
              apps: rec.securityInputs.apps && Array.isArray(rec.securityInputs.apps.apps) ? rec.securityInputs.apps : null,
            },
          }
        : {}),
    };
  } catch {
    return undefined;
  }
}
