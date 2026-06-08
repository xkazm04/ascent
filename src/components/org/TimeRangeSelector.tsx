"use client";

// The org dashboard's period control. Presets (30d · 90d · Quarter · All · Custom) write the
// `?range=` query param; the page reads it back (resolveWindow) to drive the trend, movers, and
// per-tile period deltas. Custom reveals a from→to date pair. URL-as-state keeps the window
// shareable and survives a refresh — the server component re-renders on each navigation.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { RANGE_OPTIONS, type RangeKey } from "@/lib/window";

export function TimeRangeSelector({ range, from, to }: { range: RangeKey; from?: string; to?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [customOpen, setCustomOpen] = useState(range === "custom");
  const [fromVal, setFromVal] = useState(from ?? "");
  const [toVal, setToVal] = useState(to ?? "");

  function navigate(next: { range: RangeKey; from?: string; to?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("range");
    params.delete("from");
    params.delete("to");
    params.set("range", next.range);
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    router.push(`${pathname}?${params.toString()}`);
  }

  function selectPreset(key: RangeKey) {
    if (key === "custom") {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    navigate({ range: key });
  }

  function applyCustom() {
    if (!fromVal) return;
    navigate({ range: "custom", from: fromVal, to: toVal || undefined });
  }

  const inputCls =
    "rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1 font-mono text-sm text-slate-200 [color-scheme:dark] focus:border-accent focus:outline-none";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center rounded-lg border border-slate-800 bg-slate-900/40 p-0.5">
        {RANGE_OPTIONS.map((o) => {
          const active = o.key === "custom" ? customOpen || range === "custom" : range === o.key && !customOpen;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => selectPreset(o.key)}
              aria-pressed={active}
              className={`rounded-md px-2.5 py-1 font-mono text-sm transition ${
                active ? "bg-accent font-semibold text-[#04070e]" : "text-slate-400 hover:text-white"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {(customOpen || range === "custom") && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            aria-label="From date"
            value={fromVal}
            max={toVal || undefined}
            onChange={(e) => setFromVal(e.target.value)}
            className={inputCls}
          />
          <span className="text-slate-600" aria-hidden>
            →
          </span>
          <input
            type="date"
            aria-label="To date"
            value={toVal}
            min={fromVal || undefined}
            onChange={(e) => setToVal(e.target.value)}
            className={inputCls}
          />
          <button
            type="button"
            onClick={applyCustom}
            disabled={!fromVal}
            className="rounded-md border border-slate-700 px-2.5 py-1 font-mono text-sm text-slate-200 transition hover:border-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
