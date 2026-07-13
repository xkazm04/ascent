// The actionable follow-up behind the Teams tab's "Unowned repos" count: which scanned repos have no
// CODEOWNERS team (weakest overall first — where attention helps most), each linked to its report,
// plus the exact snippet that fixes attribution. Collapsed by default: it's a fix-it list, not a
// headline.
//
// Each row is now a DECISION, not just a chip. An unowned repo is a finding a human must judge —
// assign an owner, or record why it stays unowned — and until they do it counts toward the org rail's
// Teams badge. Resolved rows sink to the bottom, greyed, with the rationale that agents will read.

import Link from "next/link";
import { DecisionControl } from "@/components/org/DecisionControl";
import type { OrgTeamRollup } from "@/lib/db";
import { isOpen, type DecisionMap } from "@/lib/org/decision-map";
import { scoreHex } from "@/lib/ui";

export function TeamsUnowned({
  slug,
  unowned,
  decisions,
}: {
  slug: string;
  unowned: OrgTeamRollup["unowned"];
  decisions: DecisionMap;
}) {
  if (unowned.length === 0) return null;

  // Undecided first (that's the work), resolved after — each group keeps the weakest-first order.
  const open = unowned.filter((r) => isOpen(decisions, r.fullName));
  const resolved = unowned.filter((r) => !isOpen(decisions, r.fullName));

  return (
    <details id="unowned" className="mt-8 scroll-mt-24 rounded-xl border border-slate-800 bg-slate-900/20">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 font-medium text-slate-200 marker:text-slate-600">
        <span>
          Unowned repos <span className="font-mono text-sm text-slate-500">({open.length} to decide)</span>
        </span>
        <span className="font-mono text-sm uppercase tracking-widest text-orange-400">no CODEOWNERS team — expand to fix</span>
      </summary>
      <div className="border-t border-slate-800 px-4 py-4">
        <p className="max-w-3xl text-sm text-slate-400">
          These scanned repos aren&apos;t attributed to any team, so their scores roll up to no one. Add a{" "}
          <span className="font-mono text-slate-300">.github/CODEOWNERS</span> naming an{" "}
          <span className="font-mono text-slate-300">@{slug}/…</span> team, then re-scan — listed weakest first, where an
          owner would help most. Accept the work, or dismiss with a reason; either way it leaves the badge.
        </p>

        <ul className="mt-4 divide-y divide-divider rounded-lg border border-divider">
          {[...open, ...resolved].map((r) => {
            const decision = decisions[r.fullName];
            const settled = !isOpen(decisions, r.fullName);
            return (
              <li
                key={r.fullName}
                className={`flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 ${settled ? "opacity-60" : ""}`}
              >
                <Link
                  href={`/report/${r.fullName}`}
                  className="focus-ring min-w-0 truncate rounded font-mono text-sm text-slate-300 transition hover:text-white"
                  title={`${r.fullName} · overall ${r.overall} — open report`}
                >
                  {r.name}
                  <span className="ml-2 tabular-nums" style={{ color: scoreHex(r.overall) }}>
                    {r.overall}
                  </span>
                </Link>
                <DecisionControl
                  org={slug}
                  module="teams"
                  itemKey={r.fullName}
                  title={`${r.fullName} has no owning team`}
                  status={decision?.status ?? "open"}
                  rationale={decision?.rationale}
                  decidedBy={decision?.decidedBy}
                />
              </li>
            );
          })}
        </ul>

        <pre className="mt-4 max-w-md overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-sm text-slate-300">
          {`# .github/CODEOWNERS\n*  @${slug}/your-team`}
        </pre>
      </div>
    </details>
  );
}
