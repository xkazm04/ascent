"use client";

// Sandbox → tracker bridge (roadmap-recommendation-tracking #6/D6). The Roadmap Sandbox models the
// cheapest path to the next level with real engine math, but that plan was fully ephemeral — a team
// that just modeled its path lost it on unmount. This bar persists the sandbox's APPLIED roadmap
// items (the ones the user clicked "Try it" on) as `in_progress` recommendations via the EXISTING
// PATCH path (/api/recommendations/:id), stamping an event-trail note — no new API, no new schema.
// Items are joined to their persisted rec by the MINTED recommendation identity
// (`recommendationMatchKey`), so a static-fallback roadmap (no persisted recs) simply has nothing to
// commit and the bar disables.

import { useState } from "react";
import type { LlmRoadmapItem, PersistedRecommendation } from "@/lib/types";
import { recommendationMatchKey } from "@/lib/report/rec-identity";
import { Kicker } from "@/components/ui";

/**
 * The applied roadmap items joined to their persisted, still-OPEN recommendations. The join key is
 * `recommendationMatchKey` — the repo's ONE minted recommendation identity (dimension + a hash over
 * the normalized title), the same derivation behind dismissal decisions and saved sandbox scenarios.
 * It replaced a raw `` `${dimension}\0${title}` `` string join: the rendered title is display text,
 * not identity, so a live-LLM rephrasing of case/punctuation/whitespace between persist and render
 * matched nothing and the bar reported "already tracked" for a plan it had simply failed to join.
 * Only "open" recs are candidates: re-committing an already
 * in_progress/done/dismissed rec would either no-op or regress it. Deduped by rec id (two roadmap
 * items can name the same dimension). Empty when tracking is off (recs null) or nothing matches.
 */
export function committableRecs(
  roadmap: LlmRoadmapItem[],
  recs: PersistedRecommendation[] | null | undefined,
  appliedItems: Set<number>,
): PersistedRecommendation[] {
  if (!recs || recs.length === 0) return [];
  const byKey = new Map(recs.map((r) => [recommendationMatchKey(r.dimension, r.title), r]));
  const seen = new Set<string>();
  const out: PersistedRecommendation[] = [];
  for (const i of appliedItems) {
    const item = roadmap[i];
    if (!item) continue;
    const rec = byKey.get(recommendationMatchKey(item.dimension, item.title));
    if (rec && rec.status === "open" && !seen.has(rec.id)) {
      seen.add(rec.id);
      out.push(rec);
    }
  }
  return out;
}

type CommitState =
  | { kind: "idle" }
  | { kind: "saving"; done: number; total: number }
  | { kind: "done"; saved: number; total: number }
  /** 403 (read-only public funnel) or 503 (no DB): non-retryable — the loop stops, the button stays off. */
  | { kind: "blocked"; message: string };

export function SandboxCommitBar({
  roadmap,
  recs,
  appliedItems,
  projectedDelta,
}: {
  roadmap: LlmRoadmapItem[];
  recs: PersistedRecommendation[] | null | undefined;
  appliedItems: Set<number>;
  /** The sandbox's projected overall-score delta vs today — stamped into the event-trail note. */
  projectedDelta: number;
}) {
  const [state, setState] = useState<CommitState>({ kind: "idle" });
  const committable = committableRecs(roadmap, recs, appliedItems);
  const n = committable.length;

  // Why the button is off, spelled out on hover — the "disabled state with an explanatory title" the
  // static-fallback (no persisted recs) case needs.
  const disabledTitle = !recs
    ? "Committing needs a connected database and your own organization's scan (model here, commit from a tracked report)."
    : appliedItems.size === 0
      ? "Try a recommendation above first, then commit the ones you want to track."
      : n === 0
        ? "The recommendations you tried are already tracked, or have no persisted match to commit."
        : undefined;

  async function commit() {
    if (n === 0 || state.kind === "saving" || state.kind === "blocked") return;
    const note = `Committed from sandbox simulation, projected +${Math.max(0, Math.round(projectedDelta))} pts overall.`;
    let saved = 0;
    setState({ kind: "saving", done: 0, total: n });
    // Sequential PATCHes through the existing per-row path (no batch API). On the first 403/503, every
    // remaining rec would fail identically, so bail out with a quiet notice rather than looping the API.
    for (const rec of committable) {
      try {
        const res = await fetch(`/api/recommendations/${rec.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "in_progress", note }),
        });
        if (res.status === 403 || res.status === 503) {
          setState({
            kind: "blocked",
            message:
              res.status === 403
                ? "Committing is available for your own organization's scans; this is a read-only public report."
                : "Progress tracking isn't available here: it needs a connected database.",
          });
          return;
        }
        if (res.ok) saved += 1;
      } catch {
        // A network blip on one rec shouldn't abort the rest — the summary reports how many landed.
      }
      setState({ kind: "saving", done: saved, total: n });
    }
    setState({ kind: "done", saved, total: n });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-divider bg-slate-950/30 p-4">
      <div className="min-w-0">
        <Kicker tone="accent">Commit plan</Kicker>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-slate-400">
          Persist the recommendations you tried as <span className="text-slate-200">in progress</span> on the
          tracker: your modeled path, saved instead of lost on close.
        </p>
        {/* Polite live region so the commit outcome is announced without stealing focus. */}
        <div role="status" aria-live="polite">
          {state.kind === "done" && (
            <p className="mt-1 text-sm text-emerald-300">
              {state.saved > 0
                ? `${state.saved} recommendation${state.saved > 1 ? "s" : ""} marked in progress. Reload the roadmap to see the tracker update.`
                : "Nothing new to commit."}
            </p>
          )}
          {state.kind === "blocked" && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-amber-200/90">
              <span aria-hidden>ⓘ</span>
              {state.message}
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={commit}
        disabled={n === 0 || state.kind === "saving" || state.kind === "blocked"}
        title={disabledTitle}
        className="shrink-0 rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state.kind === "saving"
          ? `Committing ${state.done}/${state.total}…`
          : n > 0
            ? `Commit ${n} to tracker →`
            : "Commit to tracker"}
      </button>
    </div>
  );
}
