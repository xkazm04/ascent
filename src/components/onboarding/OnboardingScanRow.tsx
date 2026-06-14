import Link from "next/link";
import { LEVEL_CLASSES, LEVEL_GLYPH } from "@/lib/ui";
import type { LevelId } from "@/lib/types";

export interface ScanRow {
  repo: string;
  level?: LevelId;
  overall?: number;
  error?: string;
}

export function ScanRowView({ row }: { row: ScanRow }) {
  const done = row.level && typeof row.overall === "number";
  const lc = row.level ? LEVEL_CLASSES[row.level] : null;

  const badge = (
    <span className={`rounded border px-2 py-0.5 font-mono text-sm ${lc?.border} ${lc?.bg} ${lc?.text}`}>
      {row.level && <span aria-hidden>{LEVEL_GLYPH[row.level]} </span>}
      {row.level} · {row.overall}
    </span>
  );

  // ONB-3: a completed scan is the payoff — let the user drill straight into the report it produced.
  // `row.repo` is the `owner/name` fullName, which is exactly the /report/[owner]/[repo] path.
  if (done && !row.error) {
    return (
      <Link
        href={`/report/${row.repo}?ref=onboarding`}
        className="group flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2.5 transition hover:border-accent/50 hover:bg-slate-900/70"
        title={`Open the maturity report for ${row.repo}`}
      >
        <span className="flex-1 truncate font-mono text-base text-white">{row.repo}</span>
        <span className="font-mono text-sm text-accent opacity-0 transition group-hover:opacity-100">view report →</span>
        {badge}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2.5">
      <span className="flex-1 truncate font-mono text-base text-white">{row.repo}</span>
      {row.error ? <span className="text-sm text-danger">{row.error}</span> : <span className="text-sm text-slate-500">scanning…</span>}
    </div>
  );
}
