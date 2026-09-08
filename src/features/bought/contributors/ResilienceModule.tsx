// Org Resilience (G7-18) — bus-factor / key-person exposure, drawn instead of described.
//
// NO INDIVIDUAL IS NAMED HERE, at any population size. Every claim on this surface is about a
// REPOSITORY ("one point of failure, 92% concentration"), which is the whole of the decision value —
// you fix it by pairing, rotating ownership, or writing the repo down, none of which needs a name.
// The producer (`computeOrgResilience`) enforces that by not emitting a login at all. That guarantee
// used to be a sentence in the header; it is now the graphic itself — a quartile strip over
// repositories cannot carry a name — with the sentence demoted to the header's WhyChip.
//
// The strip is the panel's headline reading: how concentrated a TYPICAL repo in this fleet is. The
// tiles quantify it, and the risk table names the repos carrying it.

import { OrgTable, SectionHeader, Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import { Kicker } from "@/components/ui";
import { Distribution, StateSwatch, WhyChip, stateTitle } from "@/components/org/viz";
import type { ContributorInsights, OrgResilience, RepoResilienceRisk } from "@/lib/db";
import { scoreHex } from "@/lib/ui";
import { quantiles } from "./contributorStats";

/**
 * Band paint off the shared ramp, read as the INVERSE of the risk score: a critical repo is a low
 * resilience score and lands red, a low-risk one lands green. No hex is picked here (BRAND.md).
 */
const BAND_RESILIENCE: Record<RepoResilienceRisk["band"], number> = {
  critical: 10,
  high: 35,
  moderate: 60,
  low: 85,
};

/** The blend, demoted out of the trailing paragraph — the arithmetic a reader may want to audit. */
const EXPOSURE_HINT =
  "Exposure blends concentration (60%) with the inverse bus factor (40%): either alone misleads. Top " +
  "share calls a two-author 60/40 repo healthy; bus factor calls a 51/49 split as safe as twenty authors.";

/** The privacy guarantee, kept as a first-sight-adjacent claim because it is a trust claim. */
const NO_NAMES_HINT =
  "About repositories, not about people: this surface carries no contributor login at any population " +
  "size, because a 'risk' framing is where a name stops describing and starts accusing.";

function BandChip({ band }: { band: RepoResilienceRisk["band"] }) {
  const color = scoreHex(BAND_RESILIENCE[band]);
  // Label + color, never color alone — the band name is the encoding, the hue is reinforcement.
  return (
    <span
      className="rounded border px-1.5 py-0.5 type-mono-sm uppercase tracking-widest"
      style={{ borderColor: `${color}66`, color }}
    >
      {band}
    </span>
  );
}

export function ResilienceModule({
  resilience,
  concentration,
}: {
  resilience: OrgResilience;
  /** Every repo's concentration row — the strip is over the whole fleet, not the top-8 risk list. */
  concentration: ContributorInsights["concentration"];
}) {
  const { score, repos, critical, atRisk, exposedCommitShare, topRisks } = resilience;
  const spread = quantiles(concentration.map((r) => r.topShare));

  return (
    <div id="resilience" className="mt-8 scroll-mt-24">
      <SectionHeader
        title="Org resilience"
        description={`${repos} repo${repos === 1 ? "" : "s"} · recent-activity commits`}
        right={<WhyChip hint={NO_NAMES_HINT} label="who this is about" align="end" />}
      />

      <div className="mt-3 rounded-xl border border-divider bg-surface/40 p-4">
        <Kicker tone="muted">Top contributor&apos;s share of commits, per repo</Kicker>
        {spread ? (
          <Distribution
            className="mt-2 max-w-md"
            min={spread.min}
            q1={spread.q1}
            median={spread.median}
            q3={spread.q3}
            max={spread.max}
            n={spread.n}
            label="Top contributor's share of commits, per repository"
            unit="%"
            digits={0}
          />
        ) : (
          <div className="mt-2 flex items-center gap-2" title={stateTitle("missing", "fleet concentration spread")}>
            <StateSwatch state="missing" />
            <span className="type-body-sm text-slate-500">Too few repositories with commit data to spread</span>
          </div>
        )}
      </div>

      <div className={`mt-4 ${TILE_LEDGER} grid-cols-2 sm:grid-cols-4`}>
        <Tile label="Resilience" value={score} sub="100 = work is well spread" color={scoreHex(score)} />
        <Tile
          label="Single point of failure"
          value={critical}
          sub="repos effectively one-author"
          color={critical > 0 ? "var(--color-warn)" : undefined}
          href="#resilience-risks"
        />
        <Tile
          label="At risk"
          value={atRisk}
          sub="critical or high concentration"
          color={atRisk > 0 ? "var(--color-warn)" : undefined}
          href="#resilience-risks"
        />
        {/* The number that decides whether this matters: exposure on the archive is not exposure on
            the work. A high at-risk COUNT with a low commit share is a housekeeping item. */}
        <Tile
          label="Exposed activity"
          value={`${exposedCommitShare}%`}
          sub="of recent commits in at-risk repos"
          color={exposedCommitShare >= 50 ? "var(--color-warn)" : undefined}
        />
      </div>

      <div id="resilience-risks" className="mt-4 scroll-mt-24">
        <OrgTable
          caption="Repositories ranked by key-person exposure"
          head={
            <tr>
              <th className="px-4 py-2 text-left">Repo</th>
              <th className="px-3 py-2 text-right">Contributors</th>
              <th className="px-3 py-2 text-right">Bus factor</th>
              <th className="px-3 py-2 text-right">Top share</th>
              <th className="px-3 py-2 text-right">Commits</th>
              <th className="px-3 py-2 text-left">
                <span className="inline-flex items-center gap-1.5">
                  Exposure
                  <WhyChip hint={EXPOSURE_HINT} label="how exposure is blended" />
                </span>
              </th>
            </tr>
          }
        >
          {topRisks.map((r) => (
            <tr key={r.fullName} className="text-slate-300">
              <td className="px-4 py-2 type-mono-sm text-white">{r.name}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{r.contributorCount}</td>
              <td
                className="px-3 py-2 text-right font-mono tabular-nums"
                style={{ color: r.busFactor <= 1 ? "var(--color-warn)" : undefined }}
              >
                {r.busFactor}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{r.topShare}%</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">{r.totalCommits.toLocaleString()}</td>
              <td className="px-3 py-2">
                <BandChip band={r.band} />
              </td>
            </tr>
          ))}
        </OrgTable>
      </div>
    </div>
  );
}
