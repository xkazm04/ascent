"use client";

// MOONSHOT #33 — the adoption reading, directly beneath the lift strip.
//
// PracticeRolloutStrip above answers "what did applying practices put in motion and what did it move".
// This answers the question that only shows up months later: is what we wrote still there, is it still
// the shape we agreed on, and who is behind now that our own pattern has moved.
//
// NEUTRAL ACCENT, NOT scoreHex. A library behind on one pattern version is a BASELINE, not a failing
// maturity reading, and painting it on the red→green ramp would tell a leader their fleet regressed
// when nothing regressed. Same constant and same reasoning as the tab's other tiles (BAND.some).
//
// RENDERS NOTHING ON AN EMPTY LEDGER — the lift strip's rule. Three zeros read as a measured verdict.

import { ConfirmAction, batchPrConfirm } from "@/components/ConfirmAction";
import { Tile, TILE_GRID } from "@/components/org/shared/ui";
import { BAND } from "@/features/standing/adoption/AdoptionSpectrum";
import { rolloutConfirmBody } from "./practiceAdoptionRows";
import { MAX_BATCH } from "./practiceApplyShared";
import { PracticeApplyBatchResults } from "./PracticeApplyBatchResults";
import { usePracticeDrift } from "./usePracticeDrift";
import type { PracticeAdoptionSummary } from "@/lib/db/practice-adoption";

export function PracticeDriftStrip({ slug, summary }: { slug: string; summary: PracticeAdoptionSummary }) {
  const d = usePracticeDrift(slug, summary);
  if (!d.meaningful) return null;
  const { tiles, confirming, setConfirming, targets, busy, error, results, meta, openConfirm, rollOut } = d;

  return (
    <div className="space-y-2">
      <div className={TILE_GRID}>
        {tiles.map((t) => (
          <Tile
            key={t.bucket}
            label={t.label}
            value={t.value}
            sub={t.sub}
            color={t.value > 0 ? BAND.some : undefined}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {tiles
          .filter((t) => t.rollout)
          .map((t) => (
            <button
              key={t.bucket}
              onClick={() => void openConfirm(t)}
              disabled={busy}
              className="type-mono-sm uppercase tracking-widest text-accent hover:text-white disabled:opacity-50"
            >
              Roll out to the {t.value} repo{t.value === 1 ? "" : "s"} behind →
            </button>
          ))}
        {error && <p className="type-body-sm text-orange-300">{error}</p>}
      </div>

      <PracticeApplyBatchResults batchResults={results} batchSummary={meta} />

      {/* Always mounted, toggled by `open`, so the portal is armed before Cancel takes focus. */}
      <ConfirmAction
        open={confirming !== null}
        busy={busy}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const tile = confirming;
          setConfirming(null);
          if (tile) void rollOut(tile);
        }}
        {...(confirming
          ? (() => {
              const spec = batchPrConfirm(targets.length, MAX_BATCH, slug);
              return { ...spec, body: rolloutConfirmBody(spec.body, confirming.rollout!.practiceId, targets) };
            })()
          : { title: "", body: "", confirmLabel: "", tone: "default" as const })}
      />
    </div>
  );
}
