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

import { useState } from "react";
import { ConfirmAction, batchPrConfirm } from "@/components/ConfirmAction";
import { Tile, TILE_GRID } from "@/components/org/shared/ui";
import { BAND } from "@/features/standing/adoption/AdoptionSpectrum";
import { adoptionIsMeaningful, buildAdoptionTiles, rolloutConfirmBody, type AdoptionTile } from "./practiceAdoptionRows";
import { MAX_BATCH, type BatchResult } from "./practiceApplyShared";
import { PracticeApplyBatchResults } from "./PracticeApplyBatchResults";
import type { PracticeAdoptionSummary } from "@/lib/db/practice-adoption";

export function PracticeDriftStrip({ slug, summary }: { slug: string; summary: PracticeAdoptionSummary }) {
  const [confirming, setConfirming] = useState<AdoptionTile | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const [meta, setMeta] = useState<{ attempted: number; skipped: number } | null>(null);

  if (!adoptionIsMeaningful(summary)) return null;
  const tiles = buildAdoptionTiles(summary);

  /** Resolve the exact repos BEFORE the confirm opens, so the dialog can list what it will act on. */
  async function openConfirm(tile: AdoptionTile) {
    if (!tile.rollout) return;
    setError(null);
    setResults(null);
    try {
      const res = await fetch(
        `/api/practices/rollout?org=${encodeURIComponent(slug)}&practiceId=${encodeURIComponent(tile.rollout.practiceId)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not read the rollout target set.");
      const repos: string[] = tile.rollout.mode === "behind" ? data.behind : [...data.drifted, ...data.removed];
      if (repos.length === 0) {
        setError("Nothing to roll out — the target set is empty now.");
        return;
      }
      setTargets(repos);
      setConfirming(tile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the rollout target set.");
    }
  }

  async function rollOut(tile: AdoptionTile) {
    if (!tile.rollout) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/practices/rollout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, practiceId: tile.rollout.practiceId, mode: tile.rollout.mode, repos: targets }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to open the rollout PRs.");
      setResults(data.results as BatchResult[]);
      setMeta({ attempted: data.attempted ?? 0, skipped: data.skipped ?? 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open the rollout PRs.");
    } finally {
      setBusy(false);
    }
  }

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
              className="font-mono text-sm uppercase tracking-widest text-accent hover:text-white disabled:opacity-50"
            >
              Roll out to the {t.value} repo{t.value === 1 ? "" : "s"} behind →
            </button>
          ))}
        {error && <p className="text-sm text-orange-300">{error}</p>}
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
