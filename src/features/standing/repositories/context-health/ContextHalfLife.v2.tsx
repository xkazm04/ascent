// Prism context half-life: a hairline frame, paper figures, and a non-hue band reading.
// The decay scatter stays out: no kit chart draws it without a status hue. The rows carry the same repos.
import { Caption, CellMark, Frame, GhostAction, SectionHead, StatStrip, StatTile, VoidMark } from "@/components/kit";
import { orgTabHref } from "@/lib/org/orgTabs";
import { fmtCompact } from "@/lib/ui";
import { days, decayField } from "./contextDecayViz";
import { fleetContextSummary, orderByUrgency, type RepoContextRow } from "./contextHealthModel";
import { ContextDecayRowsV2 } from "./ContextDecayRows.v2";

export function ContextHalfLifeV2({ slug, rows }: { slug: string; rows: RepoContextRow[] }) {
  const s = fleetContextSummary(rows);
  const counts = {
    fresh: rows.filter((r) => r.band === "fresh").length,
    aging: rows.filter((r) => r.band === "aging").length,
    stale: rows.filter((r) => r.band === "stale").length,
    absent: rows.filter((r) => r.band === "absent").length,
  };
  const ordered = orderByUrgency(rows);
  const field = decayField(rows);
  const coverage = s.coveragePct == null ? <VoidMark subject="Context coverage" /> : `${s.coveragePct}%`;
  const half = s.medianHalfLifeDays == null ? <VoidMark subject="Fleet half-life" /> : days(s.medianHalfLifeDays);
  const past = s.freshnessKnown ? `${s.pastHalfLife}/${s.freshnessKnown}` : <VoidMark subject="Past half-life" />;
  const dead = s.deadRefsLowerBound ? `at least ${s.deadRefsTotal}` : s.deadRefsTotal;

  return (
    <Frame edge="top" pad="md" aria-label="Context half-life">
      <SectionHead
        eyebrow="Context health"
        title="Context"
        named="half-life"
        lede={`${s.assessed} of ${s.repos} assessed. Staleness is approximate: commits since the last edit are read from weekly buckets. A degraded freshness lookup is not measured.`}
        actions={<GhostAction href={orgTabHref(slug, "practices")}>Refresh via practice</GhostAction>}
      />
      <StatStrip cols={4} className="mt-6">
        <StatTile label="Context coverage" value={coverage} sub={`${s.withContext}/${s.assessed} assessed repos carry guidance`} />
        <StatTile label="Fleet half-life" value={half} sub="median, at current commit rates" />
        <StatTile label="Past half-life" value={past} sub="context files more wrong than right" />
        <StatTile
          label="Dead references"
          value={dead}
          sub={
            s.deadRefsTotal > 0
              ? `guidance pointing at deleted files, in ${s.deadRefRepos} repo${s.deadRefRepos === 1 ? "" : "s"}`
              : "every @file reference resolves"
          }
        />
      </StatStrip>
      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2" aria-label="Fleet decay bands">
        <CellMark state="met">{counts.fresh} fresh</CellMark>
        <CellMark state="partial">{counts.aging} aging</CellMark>
        <CellMark state="missing">{counts.stale} stale</CellMark>
        <CellMark state="unmeasured">{counts.absent} absent</CellMark>
        {s.notAssessed > 0 && <CellMark state="unmeasured">{s.notAssessed} not assessed</CellMark>}
      </div>
      <Caption className="mt-3">
        ≈{fmtCompact(s.unguidedCommits)} commits have landed since the fleet&apos;s context files were last edited.
      </Caption>
      {field.points.length === 0 && (
        <Caption>No repository has both a freshness reading and a commit count yet.</Caption>
      )}
      {ordered.length === 0 ? (
        <Caption className="mt-4">No repositories in scope.</Caption>
      ) : (
        <ContextDecayRowsV2 rows={ordered.slice(0, 12)} />
      )}
    </Frame>
  );
}
