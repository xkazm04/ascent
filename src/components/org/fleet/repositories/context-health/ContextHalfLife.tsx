// VARIANT 1 — "Half-life".
//
// METAPHOR: context as a decaying isotope. A CLAUDE.md doesn't rot on the calendar, it rots with
// the commits that land after it was written — so every repo's context has a measurable half-life
// set by its own change rate. The surface is a TIME instrument: one decay curve per repo, a
// half-life rule at 50%, and a fleet clock at the top.
//
// WHY IT DIFFERS from the other variants: this one refuses to grade. It answers exactly one
// question — "when does this stop being true?" — and orders the fleet by urgency of re-writing,
// not by score. The competitor's presence check ("has AGENTS.md ✓") is the thing it is arguing
// against: presence is a snapshot, potency is a clock.

import Link from "next/link";
import { Kicker, Surface } from "@/components/ui";
import { SectionHeader, Tile, TILE_LEDGER, InlineEmpty } from "@/components/org/shared/ui";
import { scoreHex, fmtCompact } from "@/lib/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import { fleetContextSummary, PROVENANCE_LABEL, type RepoContextHealth } from "./contextHealthMock";
import { HalfLifeCurve, BandBar } from "./HalfLifeCurve";

function days(d: number): string {
  if (!Number.isFinite(d)) return "∞";
  if (d < 1) return "<1d";
  if (d < 90) return `${Math.round(d)}d`;
  return `${(d / 30).toFixed(1)}mo`;
}

function DecayRow({ r }: { r: RepoContextHealth }) {
  const hex = r.present ? scoreHex(r.potency) : "#334155";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 bg-ink px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          {r.present ? (
            <Link href={`/report/${r.fullName}`} className="truncate font-mono text-sm text-white hover:text-accent">
              {r.fullName}
            </Link>
          ) : (
            <span className="truncate font-mono text-sm text-slate-400">{r.fullName}</span>
          )}
          <span className="shrink-0 font-mono text-xs uppercase tracking-[0.18em]" style={{ color: hex }}>
            {r.present ? r.primary?.path : "no context"}
          </span>
        </div>
        <p className="mt-1 truncate text-sm text-slate-400">{r.verdict}</p>
      </div>

      <div className="hidden sm:block">
        <HalfLifeCurve potency={r.potency} ariaLabel={`${r.name} context potency ${r.potency}%`} />
      </div>

      <div className="flex items-center gap-5 text-right">
        <div>
          <div className="font-mono text-lg tabular-nums" style={{ color: hex }}>
            {r.present ? `${r.potency}%` : "—"}
          </div>
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-slate-600">potency</div>
        </div>
        <div className="w-16">
          <div className="font-mono text-lg tabular-nums text-slate-300">{r.present ? days(r.halfLifeDays) : "—"}</div>
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-slate-600">½-life</div>
        </div>
        <div className="hidden w-20 md:block">
          <div className="font-mono text-lg tabular-nums text-slate-300">{fmtCompact(r.churnSinceEdit)}</div>
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-slate-600">commits since</div>
        </div>
      </div>
    </div>
  );
}

export function ContextHalfLife({ slug, rows }: { slug: string; rows: RepoContextHealth[] }) {
  const s = fleetContextSummary(rows);
  const counts = {
    fresh: rows.filter((r) => r.band === "fresh").length,
    aging: rows.filter((r) => r.band === "aging").length,
    stale: rows.filter((r) => r.band === "stale").length,
    absent: rows.filter((r) => r.band === "absent").length,
  };
  // Most-urgent first: decayed context ahead of missing context (a wrong map misleads an agent
  // further than no map), then by how much churn has landed since the last edit.
  const ordered = [...rows].sort((a, b) => {
    if (a.present !== b.present) return a.present ? -1 : 1;
    if (a.potency !== b.potency) return a.potency - b.potency;
    return b.churnSinceEdit - a.churnSinceEdit;
  });

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Context half-life"
        description="Agent context decays with the commits that land after it was written. These are the repos whose guidance has already stopped being true."
        right={
          <Link href={orgTabHref(slug, "practices")} className="focus-ring rounded-md border border-slate-700 px-3 py-1.5 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white">
            Refresh via practice →
          </Link>
        }
      />

      <div className={`${TILE_LEDGER} sm:grid-cols-2 lg:grid-cols-4`}>
        <Tile
          label="Fleet half-life"
          value={s.medianHalfLifeDays == null ? "—" : days(s.medianHalfLifeDays)}
          sub="median, at current commit rates"
        />
        <Tile
          label="Past half-life"
          value={`${s.pastHalfLife}/${s.withContext}`}
          sub="context files more wrong than right"
          color={scoreHex(s.withContext ? 100 - (s.pastHalfLife / s.withContext) * 100 : 0)}
        />
        <Tile label="Unguided commits" value={fmtCompact(s.unguidedCommits)} sub="landed since context last edited" />
        <Tile
          label="LLM-generated"
          value={s.generated}
          sub="repos where context reads machine-written"
          color={s.generated > 0 ? scoreHex(20) : undefined}
        />
      </div>

      <Surface className="p-5">
        <Kicker tone="muted">Fleet decay bands</Kicker>
        <div className="mt-3">
          <BandBar counts={counts} total={rows.length} />
        </div>
        <p className="mt-3 text-sm text-slate-400">
          {s.withContext}/{s.repos} repos carry an agent-context file — but only{" "}
          <span className="font-mono tabular-nums text-slate-200">{s.withUsableContext}</span> still read as current and
          repo-specific. Presence is the easy half.
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
        Provenance legend · {PROVENANCE_LABEL.human} · {PROVENANCE_LABEL.mixed} · {PROVENANCE_LABEL.generated}
      </p>
    </div>
  );
}
