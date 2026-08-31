"use client";

// The scan picker for the compare view — two HistoryPoint dropdowns (baseline + compared)
// plus a swap. Selection lives entirely in the URL (?a=<after>&b=<before>), so the panel is
// shareable and the back button works; changing a dropdown soft-navigates and the server
// page re-renders the diff. The opposite side's current scan is disabled so the two can't
// collapse onto the same scan.

import { usePathname, useRouter } from "next/navigation";
import type { HistoryPoint } from "@/lib/db/scans";
import type { ExemplarOption } from "@/lib/report/exemplar";
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

/**
 * The optgroup order — concrete repos before the aggregate options, so the concrete answer is first.
 * "Public corpus" / "Corpus best" are the same two slots for a viewer the org gate resolved to the
 * shared public namespace: same options, honestly named (`exemplarGroups`, UAT `SAM-L1-13`).
 */
const AGAINST_GROUPS: ExemplarOption["group"][] = [
  "Your repos",
  "Public corpus",
  "Org best",
  "Corpus best",
  "Cohort",
];

export function ScanComparePicker({
  repo,
  scans,
  beforeId,
  afterId,
  exemplarOptions = [],
  against = null,
}: {
  repo: string;
  scans: HistoryPoint[];
  beforeId: string;
  afterId: string;
  /** Exemplars this viewer may compare against (moonshot #34). Empty hides the field entirely —
   *  an org with no second eligible repo and no qualifying cohort has nothing to offer, and an
   *  empty dropdown would advertise a comparison that cannot be made. */
  exemplarOptions?: ExemplarOption[];
  /** The canonical `?against=` token currently in the URL, or null. */
  against?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const latestId = scans[0]?.id;
  // List-variant captions: absolute date+time + short sha (+ ordinal on exact collisions), so two
  // same-day scans with the same score stay distinguishable in the dropdowns (trends-comparison #4).
  const captions = scanOptionCaptions(scans, latestId);

  // G5-26: nothing enforced or hinted that the baseline should be chronologically OLDER than the
  // comparison — a user could invert the pair and get an all-red "What changed" panel that reads as a
  // regression while actually looking backward in time. `scannedAt` is an ISO string, so string
  // comparison is safe. Missing either scan (shouldn't happen — both ids come from `scans`) skips the
  // hint rather than throwing.
  const beforeScan = scans.find((s) => s.id === beforeId);
  const afterScan = scans.find((s) => s.id === afterId);
  const isInverted = Boolean(beforeScan && afterScan && beforeScan.scannedAt > afterScan.scannedAt);

  // Navigate to a new (after, before) pair — shareable URL, server re-renders the diff. Use push (not
  // replace) so each selection is its own history entry and Back steps through the prior selections,
  // matching this component's documented "the back button works" contract.
  // `against` rides along on every navigation: changing the baseline must not silently drop the
  // exemplar the reader chose, and selecting "None" must not reset the scan pair.
  const go = (after: string, before: string, exemplar: string | null = against) => {
    const params = new URLSearchParams({ repo, a: after, b: before });
    if (exemplar) params.set("against", exemplar);
    router.push(`${pathname}?${params.toString()}`);
  };

  const selectClass =
    "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 type-body text-slate-200 outline-none focus:border-accent";

  // A repo with ONE stored scan has no time comparison to offer — but it still has an exemplar
  // comparison, which needs no second scan. The time controls are hidden rather than rendered
  // inert, so the exemplar field is reachable on the first scan a repo ever gets (UAT `SAM-L1-13`).
  const timeComparable = scans.length >= 2;

  return (
    <Surface radius="2xl" className="p-4">
      {timeComparable && (
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
            className="rounded-md border border-slate-700 px-3 py-2 type-body text-slate-300 transition hover:border-accent hover:text-white"
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
      )}
      {exemplarOptions.length > 0 && (
        <div className={timeComparable ? "mt-3 border-t border-slate-800 pt-3" : ""}>
          <Field label="Against (exemplar)">
            <select
              value={against ?? ""}
              onChange={(e) => go(afterId, beforeId, e.target.value || null)}
              className={selectClass}
              aria-label="Exemplar to compare against"
            >
              <option value="">None</option>
              {AGAINST_GROUPS.map((group) => {
                const inGroup = exemplarOptions.filter((o) => o.group === group);
                if (inGroup.length === 0) return null;
                return (
                  <optgroup key={group} label={group}>
                    {inGroup.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </Field>
        </div>
      )}
      {isInverted && (
        <p className="mt-3 type-mono-sm text-warn">
          ⚠ Baseline is newer than the compared scan, so this diff looks backward in time and may read as a
          regression that&apos;s actually a prior improvement. Swap to compare chronologically.
        </p>
      )}
    </Surface>
  );
}
