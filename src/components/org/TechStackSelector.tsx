"use client";

// The org dashboard's tech-stack filter (Feature 3b). Picking a group writes `?stack=<key>` to the URL;
// the server page resolves it to the group and scopes every aggregate to that group's repos — exactly
// like SegmentSelector + `?segment=`, and they compose (segment AND stack). "All stacks" clears it.
// URL-as-state keeps the scoped view shareable and survives a refresh. Multi-membership means a
// fullstack repo shows under both "Frontend" and "Backend·Node".

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface TechStackOption {
  key: string;
  label: string;
  repoCount: number;
}

export function TechStackSelector({ groups, active }: { groups: TechStackOption[]; active: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(key: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (key) params.set("stack", key);
    else params.delete("stack");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  // No groups yet (nothing scanned, or no stack detected): render nothing rather than an empty control.
  if (groups.length === 0) return null;

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
        All stacks
      </button>
      {groups.map((g) => {
        const on = g.key === active;
        return (
          <button
            key={g.key}
            type="button"
            onClick={() => select(g.key)}
            aria-pressed={on}
            title={`${g.repoCount} repo${g.repoCount === 1 ? "" : "s"}`}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-sm transition ${
              on ? "bg-accent font-semibold text-[#04070e]" : "text-slate-400 hover:text-white"
            }`}
          >
            {g.label}
            <span className={on ? "text-[#04070e]/70" : "text-slate-600"}>{g.repoCount}</span>
          </button>
        );
      })}
    </div>
  );
}
