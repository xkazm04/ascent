"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readSSE } from "@/lib/sse";

interface Progress {
  running: boolean;
  done: number;
  total: number;
  current: string;
  error?: string;
}

export function OrgScanButton({ org, watchedCount }: { org: string; watchedCount: number }) {
  const router = useRouter();
  const [p, setP] = useState<Progress>({ running: false, done: 0, total: watchedCount, current: "" });

  async function run() {
    setP({ running: true, done: 0, total: watchedCount, current: "starting…" });
    try {
      const res = await fetch("/api/org/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org }),
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
        else if (event === "error") setP((s) => ({ ...s, running: false, error: String(data.error) }));
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
      <button
        type="button"
        onClick={run}
        disabled={p.running || watchedCount === 0}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-[#04070e] transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
      >
        {p.running ? `Scanning ${p.done}/${p.total}…` : `Scan all watched (${watchedCount})`}
      </button>
      {p.running && (
        <div className="w-48">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-slate-500">{p.current}</p>
        </div>
      )}
      {p.error && <p className="text-xs text-red-400">{p.error}</p>}
    </div>
  );
}
