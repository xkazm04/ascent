"use client";

// Adoption-ledger actions shared by the Altimeter strip and the Prism frame.
import { useState } from "react";
import { adoptionIsMeaningful, buildAdoptionTiles, type AdoptionTile } from "./practiceAdoptionRows";
import { readApiResponse, type BatchResult } from "./practiceApplyShared";
import type { PracticeAdoptionSummary } from "@/lib/db/practice-adoption";

export function usePracticeDrift(slug: string, summary: PracticeAdoptionSummary) {
  const [confirming, setConfirming] = useState<AdoptionTile | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const [meta, setMeta] = useState<{ attempted: number; skipped: number } | null>(null);
  const meaningful = adoptionIsMeaningful(summary);
  const tiles = meaningful ? buildAdoptionTiles(summary) : [];

  async function openConfirm(tile: AdoptionTile) {
    if (!tile.rollout) return;
    setError(null);
    setResults(null);
    try {
      const res = await fetch(
        `/api/practices/rollout?org=${encodeURIComponent(slug)}&practiceId=${encodeURIComponent(tile.rollout.practiceId)}`,
      );
      const read = await readApiResponse<{ behind: string[]; drifted: string[]; removed: string[] }>(
        res,
        "Could not read the rollout target set.",
      );
      if (!read.ok) throw new Error(read.error);
      const data = read.data;
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
      const read = await readApiResponse<{ results: BatchResult[]; attempted?: number; skipped?: number }>(
        res,
        "Failed to open the rollout PRs.",
      );
      if (!read.ok) throw new Error(read.error);
      const data = read.data;
      setResults(data.results as BatchResult[]);
      setMeta({ attempted: data.attempted ?? 0, skipped: data.skipped ?? 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open the rollout PRs.");
    } finally {
      setBusy(false);
    }
  }

  return { meaningful, tiles, confirming, setConfirming, targets, busy, error, results, meta, openConfirm, rollOut };
}
