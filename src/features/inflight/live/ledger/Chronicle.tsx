"use client";

// THE CHRONICLE — every run, newest first, by its STABLE number (#seq never shifts when a new run
// lands, which a position in a window did). The first page arrives with the load; "Older runs" pages
// strictly below the smallest number on screen, so no run is repeated or skipped while you read.

import { useState } from "react";
import { InlineEmpty, SectionHeader } from "@/components/org/shared/ui";
import { ChronicleRow } from "./ChronicleRow";
import { CHRONICLE_PAGE, appendPage, oldestSeq } from "./chronicleModel";
import { fetchRunsPage } from "./ledgerClient";
import { LEDGER_ANCHOR } from "./ledgerModel";
import type { LoopPlanRecord, LoopRunChronicleEntry } from "./ledgerTypes";

export function Chronicle({
  slug,
  initial,
  initialHasMore,
  modes,
  plans,
  now,
}: {
  slug: string;
  /** The first page; null = the read failed, which is said rather than drawn as "no runs". */
  initial: readonly LoopRunChronicleEntry[] | null;
  initialHasMore: boolean;
  modes: Record<string, "bounded" | "continuous">;
  plans: readonly LoopPlanRecord[];
  now: string;
}) {
  const [runs, setRuns] = useState<LoopRunChronicleEntry[]>(() => [...(initial ?? [])]);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursor = oldestSeq(runs);

  const older = async () => {
    if (cursor == null) return;
    setBusy(true);
    setError(null);
    try {
      const page = await fetchRunsPage(slug, cursor, CHRONICLE_PAGE);
      setRuns((shown) => appendPage(shown, page));
      setHasMore(page.length >= CHRONICLE_PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read older runs.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id={LEDGER_ANCHOR.chronicle} aria-labelledby="ledger-chronicle-h" className="scroll-mt-24 space-y-3">
      <SectionHeader
        title={<span id="ledger-chronicle-h">Chronicle</span>}
        description="Every run, by its stable number. Open one for its lanes: what was offered, what was armed, what the rescan verified."
      />
      {initial == null ? (
        <p role="alert" className="type-body-sm text-warn">
          Could not read the runs.
        </p>
      ) : runs.length === 0 ? (
        <InlineEmpty>No run yet. The first one — the runner&apos;s or yours from the Cockpit — starts the chronicle.</InlineEmpty>
      ) : (
        <>
          <ul className="divide-y divide-divider rounded-2xl border border-divider">
            {runs.map((r) => (
              <ChronicleRow key={r.id} slug={slug} run={r} modes={modes} plans={plans} now={now} />
            ))}
          </ul>
          {hasMore && cursor != null && (
            <button
              type="button"
              onClick={() => void older()}
              disabled={busy}
              className="focus-ring rounded-lg border border-divider px-3 py-1.5 type-caption text-slate-300 hover:border-accent hover:text-white disabled:opacity-50"
            >
              {busy ? "Reading…" : "Older runs"}
            </button>
          )}
          {error && (
            <p role="alert" className="type-caption text-danger">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
