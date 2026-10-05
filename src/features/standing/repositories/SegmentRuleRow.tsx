"use client";

// A declared segment's rule and its DRIFT, on the segment card — plus the one control that converges it.
//
// Without this row a segment whose rule matches repos nobody tagged looks complete, and that silence is
// expensive: the tagged set scopes "Scan segment" and the segment's autoscan cadence (SegmentActions),
// so drift spends credits on last month's fleet and quietly omits the new repos. The posture copies
// reconcileListedRepos (src/lib/db/org-watch.ts): show the drift, leave the remedy to an explicit act,
// never mutate the fleet behind the user's back.
//
// The drift counts arrive already computed on SegmentSummary (a pure function over repos the Segments
// view already reads), so this component issues no read of its own.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { describeSegmentRule, type SegmentRule } from "@/lib/org/segmentRule";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function SegmentRuleRow({
  org,
  segmentId,
  rule,
  drift,
}: {
  org: string;
  segmentId: string;
  rule: SegmentRule;
  /** Counts only, from SegmentSummary.drift. Null when the drift could not be computed. */
  drift: { toAdd: number; toRemove: number } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toAdd = drift?.toAdd ?? 0;
  const toRemove = drift?.toRemove ?? 0;
  const hasDrift = toAdd > 0 || toRemove > 0;

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/org/segments/${segmentId}/rule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to apply the rule.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply the rule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      <p className="type-mono-sm text-slate-500">
        Rule: <span className="text-slate-300">{describeSegmentRule(rule)}</span>
      </p>
      {hasDrift && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="type-mono-sm text-amber-300">
            {toAdd > 0 && `${toAdd} ${plural(toAdd, "repo matches", "repos match")} this rule and ${plural(toAdd, "is", "are")} not tagged`}
            {toAdd > 0 && toRemove > 0 && " · "}
            {toRemove > 0 && `${toRemove} tagged by this rule no longer ${plural(toRemove, "matches", "match")}`}
          </span>
          <button
            onClick={apply}
            disabled={busy}
            title="Tag every repo the rule matches and untag the ones it no longer does. Repos tagged by hand are never touched."
            className="rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 type-mono-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
          >
            {busy ? "Applying…" : "Apply rule"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-1 type-mono-sm text-orange-300">{error}</p>}
    </div>
  );
}
