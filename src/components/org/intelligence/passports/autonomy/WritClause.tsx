// One clause of the standing delegation order — variant C's unit. Extracted from AutonomyWrit for
// the 300-LOC rule. A clause reads as published policy: what is permitted, to whom it is granted
// (named repos), and from whom it is withheld and on what named cause.

import Link from "next/link";
import { Kicker } from "@/components/ui";
import { reportPermalink, scoreHex } from "@/lib/ui";
import { TIER_META, tierHex, type AutonomyTier, type RepoAutonomy } from "./autonomyModel";

const ROMAN = ["I", "II", "III", "IV"];

export function WritClause({
  tier,
  granted,
  withheld,
  total,
}: {
  tier: AutonomyTier;
  /** Repos holding this tier or above. */
  granted: RepoAutonomy[];
  /** Repos exactly one tier below, with the cause that withholds it. */
  withheld: RepoAutonomy[];
  total: number;
}) {
  const meta = TIER_META[tier];
  const hex = tierHex(tier);
  const pct = total ? Math.round((granted.length / total) * 100) : 0;

  // Group the withheld by the gate that names the cause — policy language, not a chart.
  const byCause = new Map<string, RepoAutonomy[]>();
  for (const r of withheld) {
    const cause = r.blocking[0]?.label ?? "unclassified";
    byCause.set(cause, [...(byCause.get(cause) ?? []), r]);
  }

  return (
    <section className="border-t border-divider py-6 first:border-t-0 first:pt-0">
      <div className="grid gap-6 md:grid-cols-[minmax(0,190px)_minmax(0,1fr)]">
        {/* Clause head */}
        <div>
          <Kicker tone="muted">Clause {ROMAN[tier]}</Kicker>
          <div className="mt-1.5 font-mono text-2xl tabular-nums font-medium" style={{ color: hex }}>
            {meta.code}
          </div>
          <div className="text-base text-slate-100">{meta.label}</div>
          <div className="mt-3 font-mono text-sm tabular-nums text-slate-400">
            <span style={{ color: scoreHex(pct) }}>{granted.length}</span> / {total} repos · {pct}%
          </div>
        </div>

        {/* Clause body */}
        <div className="space-y-4">
          <p className="text-base text-slate-100">
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-500">Permitted — </span>
            {meta.grant}
          </p>
          <p className="text-sm text-slate-400">{meta.blurb}</p>

          <div>
            <Kicker tone="muted">Granted to</Kicker>
            {granted.length === 0 ? (
              <p className="mt-1.5 text-sm text-slate-500">No repository in this scope qualifies.</p>
            ) : (
              <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                {granted.map((r) => (
                  <Link
                    key={r.fullName}
                    href={reportPermalink(r.fullName)}
                    className="font-mono text-sm text-slate-200 underline decoration-divider underline-offset-4 transition hover:text-accent hover:decoration-accent"
                  >
                    {r.name}
                  </Link>
                ))}
              </p>
            )}
          </div>

          {withheld.length > 0 && (
            <div>
              <Kicker tone="muted">Withheld, on cause</Kicker>
              <ul className="mt-1.5 space-y-2">
                {[...byCause.entries()]
                  .sort((a, b) => b[1].length - a[1].length)
                  .map(([cause, list]) => (
                    <li key={cause} className="text-sm text-slate-300">
                      <span className="text-slate-100">{cause}</span>
                      <span className="text-slate-500"> — </span>
                      {list.map((r, i) => (
                        <span key={r.fullName}>
                          {i > 0 && <span className="text-slate-600">, </span>}
                          <Link href={reportPermalink(r.fullName)} className="font-mono text-slate-300 transition hover:text-accent">
                            {r.name}
                          </Link>
                        </span>
                      ))}
                      <span className="block text-slate-500">{list[0]?.blocking[0]?.action}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
