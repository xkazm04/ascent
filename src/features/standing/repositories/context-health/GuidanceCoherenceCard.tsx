// Guidance Coherence — the arbiter's verdict, rendered (moonshot #15).
//
// Every vendor scorer favours its own format and none reads the four against each other. This card
// is the other thing: one number per repo for whether its guidance documents AGREE, the canonical
// source with the basis it was nominated on, a chip per vendor format, and each contradiction as two
// quoted lines with both paths — so the number is re-traceable to the files it was read from.
//
// It does not grade and it does not alarm. A contradiction is shown as evidence; it withholds points
// in D1 and never fires an alert or fails a gate (G4/G5). A repo with no verdict renders "—", never
// a zero bar: "not assessed" and "scored zero" are different statements about a repository.
//
// SERVER component (no hooks, no handlers) — it stays on the server side of the boundary.
//
// TYPE SCALE: every size here is a semantic `type-*` class (globals.css layer 2), not a raw
// `text-sm`/`text-[11px]`. This card was one of four files in the app still on raw utilities after the
// sweep that introduced the scale — and globals.css says that sweep "replaced every site" — so it sat
// one pixel under every sibling surface on the same page (the tokens are re-based +1px) and named its
// smallest text in absolute pixels rather than in the ramp's floor.

import Link from "next/link";
import { Kicker, Surface } from "@/components/ui";
import { SectionHeader, Tile, TILE_LEDGER, InlineEmpty } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import {
  BASIS_LABEL,
  coherenceFleetSummary,
  orderByIncoherence,
  type ProjectionChip,
  type RepoCoherenceRow,
} from "./guidanceCoherenceModel";

const CHIP_TONE: Record<ProjectionChip["state"], string> = {
  canonical: "border-accent/40 text-accent",
  "in-sync": "border-emerald-500/30 text-emerald-300",
  stale: "border-amber-500/30 text-amber-300",
  independent: "border-slate-700 text-slate-400",
  unsampled: "border-slate-800 text-slate-600",
};

function FormatChip({ chip }: { chip: ProjectionChip }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 type-micro font-mono ${CHIP_TONE[chip.state]}`}
      title={`${chip.path} — ${chip.state}`}
    >
      <span className="truncate max-w-[14rem]">{chip.path}</span>
      <span className="uppercase tracking-[0.14em] opacity-70">{chip.state}</span>
    </span>
  );
}

function CoherenceRow({ r }: { r: RepoCoherenceRow }) {
  const hex = r.coherence != null ? scoreHex(r.coherence) : "#334155";
  return (
    <div className={`bg-ink px-5 py-4 ${r.assessed ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Link href={`/report/${r.fullName}`} className="truncate type-mono-sm text-white hover:text-accent">
          {r.fullName}
        </Link>
        <div className="flex items-baseline gap-2">
          <span className="type-lede font-mono tabular-nums" style={{ color: hex }}>
            {r.coherence != null ? r.coherence : "—"}
          </span>
          <span className="type-label tracking-[0.18em] text-slate-600">coherence</span>
        </div>
      </div>
      <p className="mt-1 type-body-sm text-slate-400">{r.verdict}</p>

      {r.canonical ? (
        <p className="mt-2 type-caption text-slate-500">
          canonical: <span className="text-slate-300">{r.canonical}</span>
          {r.canonicalBasis ? <span className="text-slate-600"> · {BASIS_LABEL[r.canonicalBasis]}</span> : null}
        </p>
      ) : null}

      {r.projections.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {r.projections.map((c) => (
            <FormatChip key={c.path} chip={c} />
          ))}
        </div>
      ) : null}

      {r.penalties.length ? (
        <ul className="mt-3 space-y-1">
          {r.penalties.map((p) => (
            <li key={p.reason} className="type-note text-slate-500">
              <span className="font-mono text-amber-300">−{p.points}</span> {p.reason}
              <span className="block type-micro font-mono text-slate-600">{p.paths.join(" ↔ ")}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {r.contradictions.length ? (
        <ul className="mt-3 space-y-2 border-l border-slate-800 pl-3">
          {r.contradictions.slice(0, 4).map((c) => (
            <li key={`${c.kind}:${c.subject}:${c.a.path}`} className="type-note">
              <span className="type-label tracking-[0.14em] text-slate-600">
                {c.kind} · {c.subject}
                {c.confidence === "possible" ? " · possible" : ""}
              </span>
              <span className="mt-0.5 block type-caption text-slate-400">
                {c.a.path}: <span className="text-slate-300">&ldquo;{c.a.quote}&rdquo;</span>
              </span>
              <span className="block type-caption text-slate-400">
                {c.b.path}: <span className="text-slate-300">&ldquo;{c.b.quote}&rdquo;</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function GuidanceCoherenceCard({ rows }: { rows: RepoCoherenceRow[] }) {
  const s = coherenceFleetSummary(rows);
  const ordered = orderByIncoherence(rows).filter((r) => r.assessed);
  return (
    <Surface className="p-6">
      <SectionHeader
        title="Guidance coherence"
        description="Every vendor format read against the others: which document is the authority, which are in-sync projections of it, and where they tell an agent different things."
        right={<Kicker>{`r11 · ${s.measured} assessed`}</Kicker>}
      />
      <div className={`mt-5 ${TILE_LEDGER}`}>
        <Tile
          label="Mean coherence"
          value={s.meanCoherence != null ? s.meanCoherence : "—"}
          sub={s.measured ? `over ${s.measured} assessed` : "nothing assessed yet"}
          color={s.meanCoherence != null ? scoreHex(s.meanCoherence) : undefined}
        />
        <Tile label="Contradicting" value={s.contradicting} sub="agent gets two answers" />
        <Tile label="Not assessed" value={s.unmeasured} sub="excluded from every share" />
      </div>
      <p className="mt-3 type-body-sm text-slate-400">{s.headline}</p>

      {ordered.length ? (
        <div className={`mt-5 ${TILE_LEDGER}`}>
          {ordered.map((r) => (
            <CoherenceRow key={r.fullName} r={r} />
          ))}
        </div>
      ) : (
        // State-aware, and from the model so it is unit-tested beside the headline it sits under: an
        // org with NO repositories in scope was previously told to "re-scan", which is not a remedy it
        // can act on. `emptyMessage` is non-null exactly when this branch renders.
        <InlineEmpty>{s.emptyMessage}</InlineEmpty>
      )}
    </Surface>
  );
}
