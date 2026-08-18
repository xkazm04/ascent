// Context Half-life — the Repositories tab's context-layer lens, REAL as of W4 (the P4 prototype's
// winning variant, now fed by persisted scan output instead of the deleted mock).
//
// METAPHOR: context as a decaying isotope. A CLAUDE.md doesn't rot on the calendar, it rots with
// the commits that land after it was written — so every repo's context has a measurable half-life
// set by its own change rate. The surface refuses to grade; it answers "when did this stop being
// true?" and orders the fleet by urgency of re-writing.
//
// HONESTY: staleness figures are ≈ (bucket-derived); a degraded freshness lookup renders as
// "unknown", and a repo scanned before this signal existed renders as "not assessed — re-scan",
// never as fabricated freshness.

import Link from "next/link";
import { Kicker, Surface } from "@/components/ui";
import { SectionHeader, Tile, TILE_LEDGER, InlineEmpty } from "@/components/org/shared/ui";
import { scoreHex, fmtCompact } from "@/lib/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import { fleetContextSummary, orderByUrgency, type RepoContextRow } from "./contextHealthModel";
import { HalfLifeCurve, BandBar } from "./HalfLifeCurve";

function days(d: number): string {
  if (!Number.isFinite(d)) return "∞";
  if (d < 1) return "<1d";
  if (d < 90) return `${Math.round(d)}d`;
  return `${(d / 30).toFixed(1)}mo`;
}

function DecayRow({ r }: { r: RepoContextRow }) {
  const hex = r.present && r.potency != null ? scoreHex(r.potency) : "#334155";
  const dim = !r.assessed;
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 bg-ink px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_9rem_auto] ${dim ? "opacity-70" : ""}`}
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          {r.scanned ? (
            <Link href={`/report/${r.fullName}`} className="truncate font-mono text-sm text-white hover:text-accent">
              {r.fullName}
            </Link>
          ) : (
            <span className="truncate font-mono text-sm text-slate-400">{r.fullName}</span>
          )}
          <span className="shrink-0 font-mono text-xs uppercase tracking-[0.18em]" style={{ color: hex }}>
            {!r.assessed ? "not assessed" : r.present ? r.primaryPath : "no context"}
          </span>
        </div>
        <p className="mt-1 truncate text-sm text-slate-400">{r.verdict}</p>
      </div>

      <div className="hidden sm:block">
        {r.assessed && r.present && r.potency != null ? (
          <HalfLifeCurve potency={r.potency} ariaLabel={`${r.name} context potency ${r.potency}%`} />
        ) : (
          <span aria-hidden className="block h-[34px]" />
        )}
      </div>

      <div className="flex items-center gap-5 text-right">
        <div>
          <div className="font-mono text-lg tabular-nums" style={{ color: hex }}>
            {r.assessed && r.present ? (r.potency != null ? `${r.potency}%` : "?") : "—"}
          </div>
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-slate-600">potency</div>
        </div>
        <div className="w-16">
          <div className="font-mono text-lg tabular-nums text-slate-300">
            {r.assessed && r.present && r.halfLifeDays != null ? days(r.halfLifeDays) : "—"}
          </div>
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-slate-600">½-life</div>
        </div>
        <div className="hidden w-20 md:block">
          <div className="font-mono text-lg tabular-nums text-slate-300">
            {r.commitsSinceEdit != null ? `≈${fmtCompact(r.commitsSinceEdit)}${r.windowCapped ? "+" : ""}` : "—"}
          </div>
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-slate-600">commits since</div>
        </div>
      </div>
    </div>
  );
}

export function ContextHalfLife({ slug, rows }: { slug: string; rows: RepoContextRow[] }) {
  const s = fleetContextSummary(rows);
  // Band split over CLASSIFIABLE rows only — unknown-freshness and unassessed repos are named in
  // prose below rather than painted into a band they were never measured for.
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
        description="Agent context decays with the commits that land after it was written. These are the repos whose guidance has already stopped being true."
        right={
          <Link
            href={orgTabHref(slug, "practices")}
            className="focus-ring rounded-md border border-slate-700 px-3 py-1.5 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white"
          >
            Refresh via practice →
          </Link>
        }
      />

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
        <p className="mt-3 text-sm text-slate-400">
          {s.withContext}/{s.assessed} assessed repos carry an agent-context file;{" "}
          <span className="font-mono tabular-nums text-slate-200">≈{fmtCompact(s.unguidedCommits)}</span> commits have
          landed since those files were last edited (approximate: read from weekly commit buckets, not per-commit
          history).
          {s.notAssessed > 0 && (
            <>
              {" "}
              <span className="text-slate-300">
                {s.notAssessed} repo{s.notAssessed === 1 ? " was" : "s were"} scanned before context health existed;
                re-scan to measure {s.notAssessed === 1 ? "it" : "them"}.
              </span>
            </>
          )}
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

      <p className="font-mono text-xs uppercase tracking-[0.18em] text-slate-600">
        Staleness is ≈ by design · freshness "?" = history lookup degraded, never fabricated
      </p>
    </div>
  );
}
