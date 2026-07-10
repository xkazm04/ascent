// The actionable follow-up behind the Teams tab's "Unowned repos" count: which scanned repos have no
// CODEOWNERS team (weakest overall first — where attention helps most), each linked to its report,
// plus the exact snippet that fixes attribution. Collapsed by default: it's a fix-it list, not a
// headline. Server-safe.

import Link from "next/link";
import type { OrgTeamRollup } from "@/lib/db";
import { scoreHex } from "@/lib/ui";

export function TeamsUnowned({ slug, unowned }: { slug: string; unowned: OrgTeamRollup["unowned"] }) {
  if (unowned.length === 0) return null;
  return (
    <details id="unowned" className="mt-8 scroll-mt-24 rounded-xl border border-slate-800 bg-slate-900/20">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 font-medium text-slate-200 marker:text-slate-600">
        <span>
          Unowned repos <span className="font-mono text-sm text-slate-500">({unowned.length})</span>
        </span>
        <span className="font-mono text-sm uppercase tracking-widest text-orange-400">no CODEOWNERS team — expand to fix</span>
      </summary>
      <div className="border-t border-slate-800 px-4 py-4">
        <p className="max-w-3xl text-sm text-slate-400">
          These scanned repos aren&apos;t attributed to any team, so their scores roll up to no one. Add a{" "}
          <span className="font-mono text-slate-300">.github/CODEOWNERS</span> naming an{" "}
          <span className="font-mono text-slate-300">@{slug}/…</span> team, then re-scan — listed weakest first, where an
          owner would help most.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {unowned.map((r) => (
            <Link
              key={r.fullName}
              href={`/report/${r.fullName}`}
              className="focus-ring rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-400 transition hover:border-accent hover:text-white"
              title={`${r.fullName} · overall ${r.overall} — open report`}
            >
              {r.name}
              <span className="ml-1" style={{ color: scoreHex(r.overall) }}>{r.overall}</span>
            </Link>
          ))}
        </div>
        <pre className="mt-4 max-w-md overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-sm text-slate-300">
          {`# .github/CODEOWNERS\n*  @${slug}/your-team`}
        </pre>
      </div>
    </details>
  );
}
