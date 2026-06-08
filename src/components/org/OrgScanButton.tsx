"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { readSSE } from "@/lib/sse";
import { Meter } from "@/components/org/ui";

interface Progress {
  running: boolean;
  done: number;
  total: number;
  current: string;
  /** Per-repo scan failures observed during the bulk run (from the server's `repo` events). */
  failed: number;
  error?: string;
}

export function OrgScanButton({ org, watchedCount }: { org: string; watchedCount: number }) {
  const router = useRouter();
  const [p, setP] = useState<Progress>({ running: false, done: 0, total: watchedCount, current: "", failed: 0 });

  async function run(scope?: { staleOnlyDays?: number }) {
    setP({ running: true, done: 0, total: watchedCount, current: "starting…", failed: 0 });
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
          // The server emits one `repo` event per repo, carrying `error` on a per-repo failure. The
          // old consumer ignored these, so 3 failed repos in a 10-repo run still read as 10/10
          // success — count them so the partial outcome is visible.
          if (data.error) setP((s) => ({ ...s, failed: s.failed + 1 }));
        } else if (event === "error") setP((s) => ({ ...s, running: false, error: String(data.error) }));
      });
      setP((s) => ({ ...s, running: false, current: "" }));
      router.refresh();
    } catch {
      setP((s) => ({ ...s, running: false, error: "Network error." }));
    }
  }

  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
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
          {p.running ? `Scanning ${p.done}/${p.total}…` : `Scan all watched (${watchedCount})`}
        </button>
        <button
          type="button"
          onClick={() => run({ staleOnlyDays: 14 })}
          disabled={p.running || watchedCount === 0}
          title="Rescan only repos not scanned in the last 14 days — saves token budget"
          className="rounded-lg border border-slate-700 px-3 py-2 text-base text-slate-300 transition hover:border-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Stale only
        </button>
      </div>
      {p.running && (
        <div className="w-48">
          <Meter value={Math.max(4, pct)} size="sm" />
          <p className="mt-1 truncate font-mono text-sm text-slate-500">{p.current}</p>
        </div>
      )}
      {!p.running && watchedCount === 0 && (
        <Link
          href="/connect"
          className="focus-ring font-mono text-sm text-slate-500 transition hover:text-accent"
        >
          Watch repos on Connect →
        </Link>
      )}
      {!p.running && p.failed > 0 && !p.error && (
        <p className="text-sm text-warn">
          {p.failed} {p.failed === 1 ? "repo" : "repos"} failed to scan — see the Repositories tab.
        </p>
      )}
      {p.error && <p className="text-sm text-danger">{p.error}</p>}
    </div>
  );
}
