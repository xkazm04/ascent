"use client";

// The playbook card's adoption + lift readout, and the "track this rollout as an Initiative" action
// (PLAY-5). Extracted verbatim from PlaybookCard — behavior unchanged — so that file stays under the
// 300-LOC cap once the fleet-rollout control landed (G7-24). The tracking state is genuinely local to
// this block (nothing else on the card reads it), so it moves with the markup.

import { useState } from "react";
import type { PlaybookAdoption, PlaybookRow } from "@/lib/db";

export function PlaybookAdoptionRow({
  playbook: p,
  slug,
  adoption,
  applied,
}: {
  playbook: PlaybookRow;
  slug: string;
  adoption: PlaybookAdoption | undefined;
  /** The card's live (optimistic) adopted-repo set. */
  applied: string[];
}) {
  // The repo set captured the last time this rollout was tracked (null = never tracked). Snapshotting
  // the scope lets us re-enable "Update initiative" when adoption grows beyond what was tracked, and
  // distinguishes "tracked" from "tracked but now stale" instead of a one-shot boolean.
  const [trackedRepos, setTrackedRepos] = useState<string[] | null>(null);
  const [tracking, setTracking] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  // Tracked, and the current applied set still matches the scope we tracked → nothing to update.
  const trackedUpToDate =
    trackedRepos != null && applied.length === trackedRepos.length && applied.every((r) => trackedRepos.includes(r));
  const lift = adoption?.lift ?? null;

  async function trackAsInitiative() {
    if (tracking || trackedUpToDate || applied.length === 0) return;
    setTracking(true);
    setTrackError(null);
    const snapshot = [...applied];
    try {
      const res = await fetch("/api/org/initiatives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, title: `Roll out: ${p.title}`, dimId: p.dimId, repos: snapshot, playbookId: p.id }),
      });
      if (res.ok) setTrackedRepos(snapshot);
      // Surface the API rejection instead of silently looking idle again.
      else setTrackError((await res.json().catch(() => ({})))?.error ?? "Couldn't track this rollout.");
    } catch {
      setTrackError("Couldn't track this rollout — try again.");
    } finally {
      setTracking(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-800 pt-3 text-sm">
      <span className="font-mono text-slate-400">
        Adopted by <span className="text-white">{applied.length}</span> repo{applied.length === 1 ? "" : "s"}
      </span>
      {lift != null && (
        // Treat a flat lift (0, or a sub-0.5 average rounded to 0) as NEUTRAL — no arrow, muted text —
        // so a zero never paints a green "▲ +0" that implies improvement where there was none. Use the
        // design-system emerald/orange tokens (as the rest of the card does) instead of inline hex, so
        // the badge follows theming. (playbooks #5)
        // The badge always shows its SAMPLE: `measured` is the server's honesty companion (how many
        // applications had a pre-apply baseline + a later scan) — without it "▲ +9 avg" backed by 1 of
        // 12 repos reads as fleet-wide improvement (ambiguity-ui 07-16 playbooks #3). Both counts come
        // from the same server snapshot (adoption), not the optimistic local `applied` chip set.
        <span
          className={`font-mono ${lift > 0 ? "text-emerald-300" : lift < 0 ? "text-orange-300" : "text-slate-400"}`}
          title={`Average ${p.dimId} change in applied repos since they applied this playbook — measured in ${adoption?.measured ?? 0} of ${adoption?.repos ?? 0} adopting repos (only repos with a scan before and after adoption count)`}
        >
          {lift > 0 ? `▲ +${lift}` : lift < 0 ? `▼ ${lift}` : "± 0"} avg {p.dimId} since{" "}
          <span className="text-slate-500">
            ({adoption?.measured ?? 0}/{adoption?.repos ?? 0} measured)
          </span>
        </span>
      )}
      {applied.length > 0 &&
        (trackedUpToDate ? (
          <span className="font-mono text-sm text-emerald-300" title="Track this rollout on the Plan tab">✓ Tracked as initiative</span>
        ) : (
          <button
            onClick={trackAsInitiative}
            disabled={tracking}
            className="font-mono text-sm text-accent hover:text-white disabled:opacity-50"
            title={trackedRepos ? "Update the tracked initiative to cover the newly-adopted repos" : "Track this playbook's rollout as an initiative on the Plan tab"}
          >
            {tracking ? "Tracking…" : trackedRepos ? "Update initiative →" : "Track as initiative →"}
          </button>
        ))}
      {trackError && <span role="alert" className="font-mono text-sm text-orange-300">{trackError}</span>}
    </div>
  );
}
