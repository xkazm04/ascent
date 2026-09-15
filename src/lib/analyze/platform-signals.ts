// Platform-observed signals → dimension folds (deepening pass, 2026-08-17).
//
// Two GitHub-side enrichments that a file scan cannot see are folded here, ADDITIVELY, into the
// deterministic dimension scores, in the same shape as applyPrSignals / applyGovernanceSignals
// (analyze/pulls.ts): presence of a good thing earns a modest, evidence-labelled credit; absence is
// neutral, because an anonymous scan cannot observe either source and a token-gated penalty would make
// the same repo score LOWER the more you let Ascent see.
//
//  • App inventory (github/check-suites.ts) — the GitHub Apps that posted a check suite on the scored
//    commit. Folds: D4 (AI review / agent Apps installed, when the workflow scan found none),
//    D3 (a non-Actions CI or a deploy platform posting suites), D2 (a coverage reporter wired in).
//    D9's share of the inventory (code scanning, supply-chain scanners) lives in security/checks.ts,
//    because D9 is the deterministic battery, not a Scorer detector.
//  • CI health (github/actions-health.ts) — recent default-branch Actions runs. Fold: D3.
//
// Every added Signal carries a `detail` with the concrete slugs / counts (BACKLOG B4: evidence must
// be re-traceable, not a label). A crashed detector (`failed`) is never decorated (G3-08).
//
import { appsOf, type AppInventory, type AppSuite } from "@/lib/github/check-suites";
import type { CiHealth } from "@/lib/github/actions-health";
import type { DimensionSignals, PlatformFoldDim, PlatformSignalRecord, Signal } from "@/lib/types";
import { PLATFORM_FOLD_DIMS } from "@/lib/analyze/platform-carry";
import { facetPoints } from "@/lib/scoring/claims";

/** Local 0..100 clamp — the same shape applyPrSignals uses, kept module-local so the fold has no
 *  dependency on the rubric module (this file only ever adds points to an existing score). */
function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** The App slugs behind a credit, as the evidence `detail` renders them. */
function slugsOf(apps: AppSuite[]): string {
  return apps.map((a) => a.slug).join(", ");
}

/** D3's existing "a CI system exists" labels (analyze/index.ts). Matching ANY of them means the file
 *  scan already found the pipeline, so an App posting checks is corroboration, not a discovery. */
const CI_PRESENT = /^(GitHub Actions CI present|CI pipeline present|Off-GitHub CI detected)/;
/** D3's existing "something deploys automatically" label. */
const DEPLOY_PRESENT = "Automated deploy step";

/**
 * Fold the installed-App inventory into D2/D3/D4. No-op on null (not observable).
 *
 * Each rule is "credit the thing the file scan could not see, once": when the deterministic detector
 * already found the same capability in committed files, the App is appended as EVIDENCE with zero
 * points, so a repo can't be paid twice for one pipeline.
 */
export function applyAppInventorySignals(
  signals: DimensionSignals[],
  inventory: AppInventory | null | undefined,
): DimensionSignals[] {
  if (!inventory) return signals;

  const aiReview = appsOf(inventory, "ai-review");
  const ci = appsOf(inventory, "ci");
  const deploy = appsOf(inventory, "deploy");
  const coverage = appsOf(inventory, "coverage");
  // A 200 with no scoreable Apps (or only sast/supply-chain ones, which D9 owns) changes nothing.
  if (!aiReview.length && !ci.length && !deploy.length && !coverage.length) return signals;

  return signals.map((s) => {
    // Never decorate a crashed detector's placeholder score with real-looking evidence (G3-08) —
    // the same guard applyPrSignals / applyGovernanceSignals carry.
    if (s.failed) return s;

    if (s.id === "D4" && aiReview.length) {
      // r9: an installed review App is an INSTANCE of the automated_review facet (scoring/claims.ts),
      // not a separate 25. If the detector already evidenced the facet this is confirmation; otherwise
      // it awards the facet's points and marks it, so a model claim for the same facet cannot double it.
      const facets = new Set(s.facets ?? []);
      const configured = facets.has("automated_review");
      if (!configured) facets.add("automated_review");
      return {
        ...s,
        signalScore: configured ? s.signalScore : clamp(s.signalScore + facetPoints("automated_review")),
        facets: [...facets],
        signals: [
          ...s.signals,
          configured
            ? { label: "AI review App also observed on the scored commit", detail: slugsOf(aiReview) }
            : { label: "AI review/agent App installed", detail: `observed on the scored commit: ${slugsOf(aiReview)}` },
        ],
      };
    }

    if (s.id === "D3" && (ci.length || deploy.length)) {
      let score = s.signalScore;
      const added: Signal[] = [];
      if (ci.length) {
        if (s.signals.some((x) => CI_PRESENT.test(x.label))) {
          added.push({ label: "CI App also posting checks on the scored commit", detail: slugsOf(ci) });
        } else {
          // An off-Actions CI the file scan missed entirely — the pipeline is real, just not committed.
          score += 35;
          added.push({ label: "CI system posting checks", detail: slugsOf(ci) });
        }
      }
      if (deploy.length) {
        if (s.signals.some((x) => x.label === DEPLOY_PRESENT)) {
          added.push({ label: "Deploy platform also observed on the scored commit", detail: slugsOf(deploy) });
        } else {
          score += 10;
          added.push({ label: "Deploy platform wired", detail: slugsOf(deploy) });
        }
      }
      return { ...s, signalScore: clamp(score), signals: [...s.signals, ...added] };
    }

    if (s.id === "D2" && coverage.length) {
      const tracked = s.signals.some((x) => /coverage/i.test(x.label));
      return {
        ...s,
        signalScore: tracked ? s.signalScore : clamp(s.signalScore + 8),
        signals: [
          ...s.signals,
          tracked
            ? { label: "Coverage reporter also observed on the scored commit", detail: slugsOf(coverage) }
            : { label: "Coverage reporter wired", detail: slugsOf(coverage) },
        ],
      };
    }

    return s;
  });
}

/** How many currently-red workflow names the D3 evidence names before it summarises the rest. */
const MAX_FAILING_NAMES = 3;

/** `failing: a, b, c +2` — named, but bounded, so one broken fleet can't flood the evidence list. */
function failingClause(failing: string[]): string {
  if (!failing.length) return "";
  const shown = failing.slice(0, MAX_FAILING_NAMES).join(", ");
  const rest = failing.length - MAX_FAILING_NAMES;
  return ` · failing: ${shown}${rest > 0 ? ` +${rest}` : ""}`;
}

/**
 * Fold default-branch CI health into D3. No-op on null (not observable) or an empty sample.
 *
 * Additive only: a green main earns a modest credit and a red main is NAMED for the model to weigh,
 * but never subtracted — an anonymous scan cannot observe runs at all, and a token-gated penalty
 * would make the same repo score lower the more you let Ascent see.
 */
export function applyCiHealthSignals(
  signals: DimensionSignals[],
  health: CiHealth | null | undefined,
): DimensionSignals[] {
  // `sampled: 0` on a 200 is a real "no Actions runs on this branch" — an off-Actions repo whose CI
  // lives elsewhere. Nothing is observable about its health, so nothing is said about it.
  if (!health || health.sampled === 0) return signals;

  const rate = health.successRate;
  // Below the sample floor (or with no computable rate) the run history is real but unjudgeable:
  // one flake in three runs is a 67% "failure rate" that means nothing. Evidence only, no points.
  const thin = health.sampled < 5 || rate == null;

  const credit = thin ? 0 : rate >= 90 ? 8 : rate >= 75 ? 4 : 0;
  const label = thin
    ? "Default-branch CI: too few recent runs to judge"
    : rate >= 90
      ? "Default-branch CI healthy"
      : rate >= 75
        ? "Default-branch CI mostly green"
        : "Default-branch CI red";
  const detail = thin
    ? `${health.sampled} completed runs sampled`
    : `${rate}% of last ${health.sampled} runs green` +
      (health.medianDurationMin != null ? ` · median ${health.medianDurationMin} min` : "") +
      ` · ${health.workflows} workflows` +
      failingClause(health.failing);

  return signals.map((s) => {
    if (s.failed) return s; // G3-08, as above.
    if (s.id !== "D3") return s;
    return {
      ...s,
      signalScore: credit ? clamp(s.signalScore + credit) : s.signalScore,
      signals: [...s.signals, { label, detail }],
    };
  });
}

// ── the fold, as a record something else can carry ───────────────────────────────────────────────
//
// The two folds above are the ONLY place a dimension score is moved by something a file scan cannot
// see, which makes them the only part of a score a worktree rescan structurally cannot reproduce.
// `applyPlatformSignals` runs both and DIFFS the result against its own input, so the fold's effect
// becomes a value: the points it added per dimension and the evidence it added them on. That record
// is what a later local scan replays (analyze/platform-carry.ts) and what tells the green verdict
// whether D2/D3/D4 were measurable at all.
//
// It is derived from the folds rather than declared alongside them on purpose: a hand-maintained
// second description of what the fold does is a description that stops being true.

/** The evidence `after` carries that `before` did not, in order. */
function addedSignals(before: DimensionSignals | undefined, after: DimensionSignals): Signal[] {
  const seen = before?.signals.length ?? 0;
  return after.signals.slice(seen);
}

/**
 * Run both platform folds and record what they did.
 *
 * `source` is decided by observability, not by the outcome: a scan that HELD a token and found no
 * Apps observed a real zero, and must not be confused with one that could not look. `null` for both
 * enrichments means the caller could not look — the local/worktree case, and also an anonymous scan.
 */
export function applyPlatformSignals(
  signals: DimensionSignals[],
  inventory: AppInventory | null | undefined,
  ciHealth: CiHealth | null | undefined,
  opts: { observedAt: string },
): { signals: DimensionSignals[]; record: PlatformSignalRecord | null } {
  // Neither enrichment was READ. There is nothing to record here — whether that means "unavailable"
  // or "a carried fold applies" is the caller's decision, and platform-carry.ts owns it.
  if (inventory == null && ciHealth == null) return { signals, record: null };

  const folded = applyCiHealthSignals(applyAppInventorySignals(signals, inventory), ciHealth);
  const byId = new Map(signals.map((s) => [s.id, s]));
  const dims: PlatformFoldDim[] = [];
  for (const after of folded) {
    if (!(PLATFORM_FOLD_DIMS as readonly string[]).includes(after.id)) continue;
    const before = byId.get(after.id);
    const added = addedSignals(before, after);
    const points = after.signalScore - (before?.signalScore ?? after.signalScore);
    // A dimension the fold neither scored nor evidenced is not part of the record: an empty entry
    // would later replay as a claim that something was observed about it.
    if (points === 0 && added.length === 0) continue;
    dims.push({ dimId: after.id, points, signals: added });
  }
  return { signals: folded, record: { source: "observed", observedAt: opts.observedAt, dims } };
}
