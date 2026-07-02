"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { readSSE } from "@/lib/sse";
import { Meter } from "@/components/org/ui";
import { DEMO_ORG_SLUG } from "@/lib/site";

interface Progress {
  running: boolean;
  done: number;
  total: number;
  current: string;
  /** Per-repo scan failures observed during the bulk run (from the server's `repo` events). */
  failed: number;
  /** Repos skipped for lack of prepaid scan credits (`notice` up front, `repo.skipped` mid-run,
   *  authoritative total on the final `result`) — a truncated paid run must not read as success. */
  skipped: number;
  error?: string;
}

export function OrgScanButton({ org, watchedCount }: { org: string; watchedCount: number }) {
  const router = useRouter();
  const [p, setP] = useState<Progress>({ running: false, done: 0, total: watchedCount, current: "", failed: 0, skipped: 0 });

  async function run(scope?: { staleOnlyDays?: number }) {
    // For a SCOPED (stale-only) scan the count isn't known up front — the server picks the stale subset
    // — so start the denominator at 0 and let the server's first progress/notice event fill it in,
    // rather than showing a misleading "0/<all watched>" (or an instant 100% on a tiny stale subset).
    const initialTotal = scope ? 0 : watchedCount;
    setP({ running: true, done: 0, total: initialTotal, current: "starting…", failed: 0, skipped: 0 });
    try {
      const res = await fetch("/api/org/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, ...scope }),
      });
      if (!res.ok || !res.body) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        setP((s) => ({ ...s, running: false, error: d?.error ?? `Failed (${res.status}).` }));
        return;
      }
      await readSSE(res.body, ({ event, data }) => {
        if (!data) return;
        if (event === "progress")
          setP((s) => ({ ...s, done: Number(data.index) || s.done, total: Number(data.total) || s.total, current: String(data.repo ?? "") }));
        else if (event === "repo") {
          // The server emits one `repo` event per repo: `error` on a per-repo failure, `skipped`
          // when a mid-run credit reservation was lost (no score produced). The old consumer
          // ignored both, so a partial run still read as N/N success — count them so the partial
          // outcome is visible.
          if (data.error) setP((s) => ({ ...s, failed: s.failed + 1 }));
          else if (data.skipped) setP((s) => ({ ...s, skipped: s.skipped + 1 }));
        } else if (event === "notice") {
          // Up-front partial coverage: the prepaid balance covers only `scanning` of the watched
          // repos; the rest are skipped before the run starts. Count them and let `scanning` fix
          // the denominator (also fills the unknown total of a scoped run).
          const skippedN = Number(data.skipped);
          const scanning = Number(data.scanning);
          setP((s) => ({
            ...s,
            skipped: s.skipped + (Number.isFinite(skippedN) && skippedN > 0 ? skippedN : 0),
            total: Number.isFinite(scanning) && scanning > 0 ? scanning : s.total,
          }));
        } else if (event === "result") {
          // Final summary — skippedForCredits is the authoritative total (up-front slice +
          // mid-run reservation losses), so prefer it over the incremental count.
          const skippedN = Number(data.skippedForCredits);
          if (Number.isFinite(skippedN)) setP((s) => ({ ...s, skipped: skippedN }));
        } else if (event === "error") setP((s) => ({ ...s, running: false, error: String(data.error) }));
      });
      setP((s) => ({ ...s, running: false, current: "" }));
      router.refresh();
    } catch {
      setP((s) => ({ ...s, running: false, error: "Network error." }));
    }
  }

  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  // The curated demo org is seeded with synthetic histories, not live-scannable repos — a "Stale only"
  // rescan there has nothing real to refresh, so hide it (the full "Scan all watched" stays for the
  // demo walkthrough). Slug is the canonical lower-cased org row casing; DEMO_ORG_SLUG is pre-lowered.
  const isDemoOrg = org.trim().toLowerCase() === DEMO_ORG_SLUG;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => run()}
          disabled={p.running || watchedCount === 0}
          title={watchedCount === 0 ? "Watch repositories on Connect to enable scanning" : undefined}
          className="rounded-lg bg-accent px-4 py-2 text-base font-semibold text-on-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          {p.running
            ? p.total
              ? `Scanning ${p.done}/${p.total}…`
              : "Scanning…"
            : `Scan all watched (${watchedCount})`}
        </button>
        {!isDemoOrg && (
          <button
            type="button"
            onClick={() => run({ staleOnlyDays: 14 })}
            disabled={p.running || watchedCount === 0}
            title="Rescan only repos not scanned in the last 14 days — saves token budget"
            className="rounded-lg border border-slate-700 px-3 py-2 text-base text-slate-300 transition hover:border-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Stale only
          </button>
        )}
      </div>
      {/* One polite live region for the whole async lifecycle (progress + partial-outcome + error), so a
          keyboard/AT user who tabs away still hears that the long fleet scan progressed, finished, partly
          failed, was capped for credits, or errored. The meter is visual only (aria-hidden); the text
          carries the announcement. aria-atomic re-reads the region as a unit on each change. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="flex flex-col items-end gap-1">
        {p.running && (
          <div className="w-48">
            <div aria-hidden="true">
              <Meter value={Math.max(4, pct)} size="sm" />
            </div>
            <p className="mt-1 truncate font-mono text-sm text-slate-500">
              {p.total ? `Scanning ${p.done} of ${p.total}` : "Scanning"}
              {p.current ? ` — ${p.current}` : "…"}
            </p>
          </div>
        )}
        {!p.running && p.failed > 0 && !p.error && (
          <p className="text-sm text-warn">
            {p.failed} {p.failed === 1 ? "repo" : "repos"} failed to scan — see the Repositories tab.
          </p>
        )}
        {!p.running && p.skipped > 0 && !p.error && (
          <p className="text-sm text-warn">
            {p.skipped} {p.skipped === 1 ? "repo" : "repos"} skipped — out of scan credits.
          </p>
        )}
        {p.error && <p className="text-sm text-danger">{p.error}</p>}
      </div>
      {!p.running && watchedCount === 0 && (
        <Link
          href="/connect"
          className="focus-ring font-mono text-sm text-slate-500 transition hover:text-accent"
        >
          Watch repos on Connect →
        </Link>
      )}
    </div>
  );
}
