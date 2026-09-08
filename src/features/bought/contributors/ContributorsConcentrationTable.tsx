// Concentration & bus factor — the single most graphical concept on this tab, drawn.
//
// It used to be five sorted columns under the sentence "How spread out each repo's commits are. High
// top-share or bus-factor 1 = key-person risk." A reader had to infer "this org's knowledge sits in
// three people" from ranked rows. The Lorenz curve says it in one shape: the sag below the equality
// diagonal is the concentration, the shaded area IS the Gini, and the marked knee is the bus-factor
// risk point. The per-repo table stays BELOW it, where a table is the right shape — auditable
// row-level evidence, and the only surface on this tab that carries a decision control.

import { OrgTable, SectionHeader } from "@/components/org/shared/ui";
import { DecisionControl } from "@/components/org/DecisionControl";
import { ConcentrationCurve, StateSwatch, WhyChip, stateTitle } from "@/components/org/viz";
import { CHAMPION_MIN_POP, topContributorLabel } from "@/components/org/shared/champions";
import type { DecisionMap } from "@/lib/org/decision-map";
import type { ContributorInsights } from "@/lib/db";
import { AiBar } from "./AiBar";

/** The demoted A2 caveat: what the knee means for the reader, on demand rather than in the header. */
const RISK_HINT =
  "The knee is the smallest group whose absence would hurt most. In the table below, a top share at or " +
  "above 80% or a bus factor of 1 is the same finding at repository scale: key-person risk.";

export function ContributorsConcentrationTable({
  slug,
  rows,
  contributors,
  namingAllowed,
  decisions,
}: {
  slug: string;
  rows: ContributorInsights["concentration"];
  /** Per-person commit magnitudes for the org-wide curve. Empty below the naming floor. */
  contributors: ContributorInsights["contributors"];
  namingAllowed: boolean;
  decisions: DecisionMap;
}) {
  // Magnitudes only — the curve plots how much work each person carries and never which person, so
  // it stays an aggregate at every population size. Below the floor the producer emits no rows at
  // all, so there is nothing to plot; that is a WITHHOLDING, and it says so rather than degrading
  // into the kit's generic "not enough data".
  const values = contributors.map((c) => c.commits);

  return (
    <div id="concentration" className="mt-8 scroll-mt-24">
      <SectionHeader
        title="Concentration & bus factor"
        right={<WhyChip hint={RISK_HINT} label="the risk knee" align="end" />}
      />
      {namingAllowed ? (
        <ConcentrationCurve
          className="mt-3 max-w-md"
          values={values}
          subjectLabel="contributors"
          valueLabel="commits"
          title="Commit concentration across contributors"
        />
      ) : (
        <div className="mt-3 flex items-center gap-2" title={stateTitle("missing", "org-wide commit concentration")}>
          <StateSwatch state="missing" />
          <span className="type-body-sm text-slate-500">
            Org-wide curve withheld below {CHAMPION_MIN_POP} contributors — the per-repo findings below are unaffected.
          </span>
        </div>
      )}
      <OrgTable
        className="mt-6"
        caption="Commit concentration and bus factor by repository"
        head={
          <tr>
            <th className="px-4 py-2 text-left">Repo</th>
            <th className="px-3 py-2 text-right">Contributors</th>
            <th className="px-3 py-2 text-left">Top contributor</th>
            <th className="px-3 py-2 text-left">Top share</th>
            <th className="px-3 py-2 text-right">Bus factor</th>
            <th className="px-3 py-2 text-left">Decision</th>
          </tr>
        }
      >
        {rows.map((r) => (
          <tr key={r.fullName} className="text-slate-300">
            <td className="px-4 py-2">
              <span className="type-mono-sm text-white">{r.name}</span>
              {r.soloMaintainer && (
                <span className="ml-2 rounded border border-orange-500/40 bg-orange-500/10 px-1.5 py-0.5 type-mono-sm uppercase tracking-widest text-orange-300">
                  key-person
                </span>
              )}
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums">{r.contributorCount}</td>
            {/* topContributorLabel, not r.topLogin: below the naming floor the producer replaces the
                login with a neutral placeholder, and rendering it raw makes "name withheld to
                protect a small population" and "we have no contributor data" the same cell. The
                typed state carries the distinction; this is the reader that shows it. */}
            <td className="px-3 py-2 type-mono-sm text-slate-400">{topContributorLabel(r)}</td>
            <td className="px-3 py-2">
              {/* `unknown` means there was no attributed commit data to take a share OF — a void, not
                  a 0% bar (§2.4). The typed state decides; nothing here string-compares a dash. */}
              <AiBar
                pct={r.topLoginState === "unknown" ? null : r.topShare}
                color={r.topShare >= 80 ? "var(--color-warn)" : undefined}
                label={`${r.name} top-contributor share`}
              />
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: r.busFactor <= 1 ? "var(--color-warn)" : undefined }}>
              {r.busFactor}
            </td>
            <td className="px-3 py-2">
              {/* Only solo-maintained repos are findings — the rest have nothing to decide. */}
              {r.soloMaintainer ? (
                <DecisionControl
                  org={slug}
                  module="contributors"
                  itemKey={r.fullName}
                  title={`${r.fullName} is solo-maintained`}
                  status={decisions[r.fullName]?.status ?? "open"}
                  rationale={decisions[r.fullName]?.rationale}
                  decidedBy={decisions[r.fullName]?.decidedBy}
                />
              ) : (
                <span className="text-slate-600">—</span>
              )}
            </td>
          </tr>
        ))}
      </OrgTable>
    </div>
  );
}
