// Context Half-life — the Repositories tab's context-layer lens, REAL as of W4 (the P4 prototype's
// winning variant, now fed by persisted scan output instead of the deleted mock).
//
// METAPHOR: context as a decaying isotope. A CLAUDE.md doesn't rot on the calendar, it rots with
// the commits that land after it was written — so every repo's context has a measurable half-life
// set by its own change rate. The surface refuses to grade; it answers "when did this stop being
// true?" and orders the fleet by urgency of re-writing.
//
// /org redesign (docs/ORG-UX-REDESIGN.md §2): the metaphor is now DRAWN. The panel opens on the
// fleet's decay field (FleetDecayScatter) rather than on a 148-character lede over four tiles, and
// the three honesty rules it used to state in prose — staleness is ≈, "?" means the lookup degraded
// and never a fabricated freshness, an unassessed repo is not a repo with no context — are the
// hatch, the void and the `<title>` on those marks.

import Link from "next/link";
import { Kicker, Surface } from "@/components/ui";
import { SectionHeader, Tile, TILE_LEDGER, InlineEmpty } from "@/components/org/shared/ui";
import { Legend, WhyChip } from "@/components/org/viz";
import { scoreHex, fmtCompact } from "@/lib/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import { fleetContextSummary, orderByUrgency, type RepoContextRow } from "./contextHealthModel";
import { days, decayField } from "./contextDecayViz";
import { FleetDecayScatter } from "./FleetDecayScatter";
import { DecayRow } from "./DecayRow";
import { BandBar } from "./HalfLifeCurve";

const APPROX_HINT =
  "Every staleness figure here is approximate by design: commits since the last edit are read from weekly buckets, not from per-commit history. A repo whose freshness lookup degraded shows as unknown rather than as a fabricated number.";

export function ContextHalfLife({ slug, rows }: { slug: string; rows: RepoContextRow[] }) {
  const s = fleetContextSummary(rows);
  const field = decayField(rows);
  // Band split over CLASSIFIABLE rows only — unknown-freshness and unassessed repos are counted
  // under the plot with their own marks rather than painted into a band nobody measured them for.
  const counts = {
    fresh: rows.filter((r) => r.band === "fresh").length,
    aging: rows.filter((r) => r.band === "aging").length,
    stale: rows.filter((r) => r.band === "stale").length,
    absent: rows.filter((r) => r.band === "absent").length,
  };
  const banded = counts.fresh + counts.aging + counts.stale + counts.absent;
  const ordered = orderByUrgency(rows);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Context half-life"
        description={`${s.assessed}/${s.repos} assessed · ≈commits since edit`}
        right={
          <Link
            href={orgTabHref(slug, "practices")}
            className="focus-ring rounded-md border border-slate-700 px-3 py-1.5 type-mono-sm text-slate-300 transition hover:border-accent hover:text-white"
          >
            Refresh via practice →
          </Link>
        }
      />

      {/* First sight: the decay itself (§2.2) — potency against the commits that caused it. */}
      <Surface className="p-5">
        <div className="flex items-center justify-between gap-3">
          <Kicker tone="muted">fleet decay field</Kicker>
          <WhyChip hint={APPROX_HINT} label="how staleness is read" align="end" />
        </div>
        <FleetDecayScatter className="mt-3 max-w-xl" field={field} />
        <Legend states={field.states} className="mt-3" />
      </Surface>

      <div className={`${TILE_LEDGER} sm:grid-cols-2 lg:grid-cols-4`}>
        <Tile
          label="Context coverage"
          value={s.coveragePct == null ? "—" : `${s.coveragePct}%`}
          sub={`${s.withContext}/${s.assessed} assessed repos carry guidance`}
          color={s.coveragePct == null ? undefined : scoreHex(s.coveragePct)}
        />
        <Tile
          label="Fleet half-life"
          value={s.medianHalfLifeDays == null ? "—" : days(s.medianHalfLifeDays)}
          sub="median, at current commit rates"
        />
        <Tile
          label="Past half-life"
          value={s.freshnessKnown ? `${s.pastHalfLife}/${s.freshnessKnown}` : "—"}
          sub="context files more wrong than right"
          color={s.freshnessKnown ? scoreHex(100 - (s.pastHalfLife / s.freshnessKnown) * 100) : undefined}
        />
        <Tile
          label="Dead references"
          value={s.deadRefsTotal}
          sub={
            s.deadRefsTotal > 0
              ? `guidance pointing at deleted files, in ${s.deadRefRepos} repo${s.deadRefRepos === 1 ? "" : "s"}`
              : "every @file reference resolves"
          }
          color={s.deadRefsTotal > 0 ? scoreHex(20) : undefined}
        />
      </div>

      <Surface className="p-5">
        <Kicker tone="muted">Fleet decay bands</Kicker>
        <div className="mt-3">
          <BandBar counts={counts} total={banded} />
        </div>
        <p className="mt-3 type-body-sm text-slate-400">
          <span className="font-mono tabular-nums text-slate-200">≈{fmtCompact(s.unguidedCommits)}</span> commits have
          landed since the fleet&apos;s context files were last edited.
        </p>
      </Surface>

      {ordered.length === 0 ? (
        <InlineEmpty>No repositories in scope.</InlineEmpty>
      ) : (
        <div className={TILE_LEDGER}>
          {ordered.slice(0, 12).map((r) => (
            <DecayRow key={r.fullName} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
