// Org Resilience (G7-18) — bus-factor / key-person exposure, promoted from two columns in a passive
// table to a read a leader can act on: one fleet score, how much of the fleet's actual work sits
// behind a single person, and which repos carry it.
//
// NO INDIVIDUAL IS NAMED HERE, at any population size. Every claim on this surface is about a
// REPOSITORY ("one point of failure, 92% concentration"), which is the whole of the decision value —
// you fix it by pairing, rotating ownership, or writing the repo down, none of which needs a name.
// The producer (`computeOrgResilience`) enforces that by not emitting a login at all, so this
// component could not leak one even if it tried. The existing "Concentration & bus factor" table
// below still shows the top contributor under the normal CHAMPION_MIN_POP naming floor — that is
// attribution, and it stays where it was; this is exposure, and exposure needs no name.

import { OrgTable, SectionHeader, Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import type { OrgResilience, RepoResilienceRisk } from "@/lib/db";
import { scoreHex } from "@/lib/ui";

const BAND: Record<RepoResilienceRisk["band"], { label: string; color: string }> = {
  critical: { label: "critical", color: "#f97316" },
  high: { label: "high", color: "#eab308" },
  moderate: { label: "moderate", color: "#94a3b8" },
  low: { label: "low", color: "#64748b" },
};

function BandChip({ band }: { band: RepoResilienceRisk["band"] }) {
  const b = BAND[band];
  // Label + color, never color alone — the band name is the encoding, the hue is reinforcement.
  return (
    <span
      className="rounded border px-1.5 py-0.5 font-mono text-sm uppercase tracking-widest"
      style={{ borderColor: `${b.color}66`, color: b.color }}
    >
      {b.label}
    </span>
  );
}

export function ResilienceModule({ resilience }: { resilience: OrgResilience }) {
  const { score, repos, critical, atRisk, exposedCommitShare, topRisks } = resilience;

  return (
    <div id="resilience" className="mt-8 scroll-mt-24">
      <SectionHeader
        title="Org resilience"
        description={
          <>
            How exposed the fleet is to any one person stepping away, derived from commit concentration and bus
            factor across {repos} repo{repos === 1 ? "" : "s"}.{" "}
            <span className="text-slate-500">About repositories, not about people: no one is named here.</span>
          </>
        }
      />

      <div className={`mt-3 ${TILE_LEDGER} grid-cols-2 sm:grid-cols-4`}>
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
              <th className="px-3 py-2 text-left">Exposure</th>
            </tr>
          }
        >
          {topRisks.map((r) => (
            <tr key={r.fullName} className="text-slate-300">
              <td className="px-4 py-2 font-mono text-sm text-white">{r.name}</td>
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

      <p className="mt-3 font-mono text-sm text-slate-600">
        Exposure blends concentration (60%) with the inverse bus factor (40%): either alone misleads. Top share
        calls a two-author 60/40 repo healthy, bus factor calls a 51/49 split as safe as twenty authors. Counts
        come from the recent-activity commit window captured at scan time.
      </p>
    </div>
  );
}
