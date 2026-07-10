"use client";

// The org dashboard's segment filter. Picking a segment writes `?segment=<id>` to the URL; the
// server page reads it back and scopes every aggregate (rollup, movers, gaps, recommendations) to
// that segment's tagged repos. "All repos" clears the filter. URL-as-state keeps the scoped view
// shareable and survives a refresh, exactly like the period control next to it.

import Link from "next/link";
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

  // No segments yet: instead of vanishing (which hid the whole feature from the tabs users live on),
  // surface a subtle pointer to where segments are created. Slug is the 2nd path segment of /org/<slug>.
  if (segments.length === 0) {
    const slug = pathname.split("/")[2];
    if (!slug) return null;
    return (
      <Link
        href={`/org/${slug}/repositories`}
        className="font-mono text-sm text-slate-500 transition hover:text-accent"
        title="Group repos into named slices on the Repositories tab"
      >
        + Create a segment →
      </Link>
    );
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/40 p-0.5">
      <button
        type="button"
        onClick={() => select(null)}
        aria-pressed={active === null}
        className={`rounded-md px-2.5 py-1 font-mono text-sm transition ${
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
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-sm transition ${
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
