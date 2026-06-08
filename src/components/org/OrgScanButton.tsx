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
        title={watchedCount === 0 ? "Watch repositories on Connect to enable scanning" : undefined}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
      >
        {p.running ? `Scanning ${p.done}/${p.total}…` : `Scan all watched (${watchedCount})`}
      </button>
      {p.running && (
        <div className="w-48">
          <Meter value={Math.max(4, pct)} size="sm" />
          <p className="mt-1 truncate font-mono text-[10px] text-slate-500">{p.current}</p>
        </div>
      )}
      {!p.running && watchedCount === 0 && (
        <Link
          href="/connect"
          className="focus-ring font-mono text-[11px] text-slate-500 transition hover:text-accent"
        >
          Watch repos on Connect →
        </Link>
      )}
      {p.error && <p className="text-xs text-danger">{p.error}</p>}
    </div>
  );
}
