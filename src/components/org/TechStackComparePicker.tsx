"use client";

// The A-vs-B selector on the tech-stacks comparison page (3b-P2). Each dropdown writes `?a=`/`?b=`
// (stack keys) to the URL; the server page reads them back and runs compareTechStacks. Side B offers
// "Whole fleet" (empty value) so a single stack can be compared against the org baseline. URL-as-state
// keeps a given comparison shareable. Mirrors SegmentComparePicker.

import { usePathname, useRouter, useSearchParams } from "next/navigation";

interface Opt {
  key: string;
  label: string;
}

export function TechStackComparePicker({ options, a, b }: { options: Opt[]; a: string; b: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function navigate(next: { a: string; b: string | null }) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("a", next.a);
    if (next.b) params.set("b", next.b);
    else params.delete("b");
    router.push(`${pathname}?${params.toString()}`);
  }

  const selectCls =
    "rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200 focus:border-accent focus:outline-none";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={a} onChange={(e) => navigate({ a: e.target.value, b })} aria-label="Stack A" className={selectCls}>
        {options.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
      <span className="font-mono text-sm text-slate-500">vs</span>
      <select value={b ?? ""} onChange={(e) => navigate({ a, b: e.target.value || null })} aria-label="Stack B" className={selectCls}>
        <option value="">Whole fleet</option>
        {options.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
