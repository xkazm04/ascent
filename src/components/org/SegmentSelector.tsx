"use client";

// The org dashboard's segment filter. Picking a segment writes `?segment=<id>` to the URL; the
// server page reads it back and scopes every aggregate (rollup, movers, gaps, recommendations) to
// that segment's tagged repos. "All repos" clears the filter. URL-as-state keeps the scoped view
// shareable and survives a refresh, exactly like the period control next to it.

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface SegmentOption {
  id: string;
  name: string;
  color: string;
  repoCount: number;
}

export function SegmentSelector({ segments, active }: { segments: SegmentOption[]; active: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("segment", id);
    else params.delete("segment");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  if (segments.length === 0) return null;

  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/40 p-0.5">
      <button
        type="button"
        onClick={() => select(null)}
        aria-pressed={active === null}
        className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition ${
          active === null ? "bg-accent font-semibold text-[#04070e]" : "text-slate-400 hover:text-white"
        }`}
      >
        All repos
      </button>
      {segments.map((s) => {
        const on = s.id === active;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => select(s.id)}
            aria-pressed={on}
            title={`${s.repoCount} repo${s.repoCount === 1 ? "" : "s"}`}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[11px] transition ${
              on ? "bg-accent font-semibold text-[#04070e]" : "text-slate-400 hover:text-white"
            }`}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: on ? "#04070e" : s.color }} />
            {s.name}
            <span className={on ? "text-[#04070e]/70" : "text-slate-600"}>{s.repoCount}</span>
          </button>
        );
      })}
    </div>
  );
}
