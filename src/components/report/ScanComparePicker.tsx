"use client";

// The scan picker for the compare view — two HistoryPoint dropdowns (baseline + compared)
// plus a swap. Selection lives entirely in the URL (?a=<after>&b=<before>), so the panel is
// shareable and the back button works; changing a dropdown soft-navigates and the server
// page re-renders the diff. The opposite side's current scan is disabled so the two can't
// collapse onto the same scan.

import { usePathname, useRouter } from "next/navigation";
import type { HistoryPoint } from "@/lib/db/scans";
import { Kicker, Surface } from "@/components/ui";
import { scanOptionCaptions } from "@/components/report/WhatChangedParts";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <Kicker tone="muted">{label}</Kicker>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function ScanComparePicker({
  repo,
  scans,
  beforeId,
  afterId,
}: {
  repo: string;
  scans: HistoryPoint[];
  beforeId: string;
  afterId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const latestId = scans[0]?.id;
  // List-variant captions: absolute date+time + short sha (+ ordinal on exact collisions), so two
  // same-day scans with the same score stay distinguishable in the dropdowns (trends-comparison #4).
  const captions = scanOptionCaptions(scans, latestId);

  // Navigate to a new (after, before) pair — shareable URL, server re-renders the diff. Use push (not
  // replace) so each selection is its own history entry and Back steps through the prior selections,
  // matching this component's documented "the back button works" contract.
  const go = (after: string, before: string) => {
    const params = new URLSearchParams({ repo, a: after, b: before });
    router.push(`${pathname}?${params.toString()}`);
  };

  const selectClass =
    "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-200 outline-none focus:border-accent";

  return (
    <Surface radius="2xl" className="p-4">
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <Field label="Baseline (before)">
          <select
            value={beforeId}
            onChange={(e) => go(afterId, e.target.value)}
            className={selectClass}
            aria-label="Baseline scan"
          >
            {scans.map((s) => (
              <option key={s.id} value={s.id} disabled={s.id === afterId}>
                {captions.get(s.id)}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex justify-center pb-1">
          {/* Swap requests before/after in the opposite time order — getScanComparison honors an
              explicit pair in EITHER direction (diffScans treats an older `after` as valid: the deltas
              read as regressions), so this navigation yields the actual swapped diff, not a silently
              substituted default baseline (trends-comparison 07-16 #1). */}
          <button
            type="button"
            onClick={() => go(beforeId, afterId)}
            aria-label="Swap baseline and compared scans"
            title="Swap"
            className="rounded-md border border-slate-700 px-3 py-2 text-base text-slate-300 transition hover:border-accent hover:text-white"
          >
            ⇄
          </button>
        </div>

        <Field label="Compared (after)">
          <select
            value={afterId}
            onChange={(e) => go(e.target.value, beforeId)}
            className={selectClass}
            aria-label="Compared scan"
          >
            {scans.map((s) => (
              <option key={s.id} value={s.id} disabled={s.id === beforeId}>
                {captions.get(s.id)}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Surface>
  );
}
