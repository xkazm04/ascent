// Presentational parts of the exemplar panel (moonshot #34). Server components — no hooks, no
// handlers — route-colocated so this lane never grows `src/components/report/**` beyond the picker.
//
// Every number is `tabular-nums` mono, every score colour comes from `scoreHex`, and there is not a
// hand-picked hex in the file. The one visual decision worth naming: the two columns are titled
// "They have · you lack" and "You have · they don't", never "better"/"worse". A signal a library
// lacks and a service carries is a difference, not a defect (see `src/lib/report/exemplar.ts`).

import Link from "next/link";
import { Kicker, Surface } from "@/components/ui";
import { DeltaPill } from "@/components/report/deltas";
import { scoreHex } from "@/lib/ui";
import type { ExemplarDiff, ExemplarDimensionDiff, TransferRow } from "@/lib/report/exemplar";

/** The amber `role="status"` notice, matching the compare page's existing unhonored-ids notice. */
export function ExemplarNotice({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-base text-amber-200/90"
    >
      <span aria-hidden>ⓘ </span>
      {children}
    </p>
  );
}

/** Rubric, engine filter, cohort population + support. A gap without its basis is not auditable. */
export function ExemplarBasis({ diff }: { diff: ExemplarDiff }) {
  const bits = [`rubric ${diff.basis.rubric}`, "mock-engine scans excluded"];
  if (diff.exemplar.population !== null) bits.push(`${diff.exemplar.population} repos in the cohort`);
  if (diff.basis.minSupport !== null) bits.push(`signal carried by ≥${diff.basis.minSupport} of the top decile`);
  return (
    <div className="mt-2 space-y-1">
      <p className="font-mono text-sm tabular-nums text-slate-500">{bits.join(" · ")}</p>
      {!diff.basis.subjectEligible && (
        <p className="text-sm text-amber-200/80">
          This repo&apos;s own scan is outside that filter (mock engine or an older rubric), so the two sides
          were measured with different instruments. The differences below are still real; the score gap is not.
        </p>
      )}
      <p className="text-sm text-slate-400">
        Signal-level, not semantic: evidence strings are model-phrased, so a reworded equivalent reads as
        absent. Treat each line as a lead to check, not a verdict.
      </p>
    </div>
  );
}

function SignalList({ items }: { items: string[] }) {
  return (
    <ul className="mt-1.5 space-y-1 text-base text-slate-300">
      {items.map((s, i) => (
        <li key={`${s}-${i}`} className="flex gap-2">
          <span aria-hidden className="text-slate-600">
            ·
          </span>
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}

function Score({ value }: { value: number | null }) {
  if (value === null) return <span className="font-mono text-sm text-slate-600">—</span>;
  return (
    <span className="font-mono text-sm tabular-nums" style={{ color: scoreHex(value) }}>
      {value}
    </span>
  );
}

/** One moved dimension: the has/lacks pair, the reverse direction, and the practice that transfers it. */
export function DimensionTransfer({ row, transfer }: { row: ExemplarDimensionDiff; transfer: TransferRow | null }) {
  return (
    <Surface radius="xl" className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-white">
          {row.id} · {row.name}
        </h3>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm tabular-nums text-slate-500">
            <Score value={row.subjectScore} /> → <Score value={row.exemplarScore} />
          </span>
          {row.comparable && row.scoreGap !== null ? (
            <DeltaPill delta={row.scoreGap} />
          ) : (
            <span className="rounded-full border border-slate-600/40 bg-slate-500/10 px-2.5 py-1 text-sm text-slate-400">
              not comparable
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <Kicker tone="accent">They have · you lack</Kicker>
          {row.absentSignals.length > 0 ? (
            <SignalList items={row.absentSignals} />
          ) : (
            <p className="mt-1.5 text-base text-slate-500">Nothing here they carry that this repo doesn&apos;t.</p>
          )}
        </div>
        <div>
          <Kicker tone="muted">Your open gaps here</Kicker>
          {row.gapsOnlyInSubject.length > 0 ? (
            <SignalList items={row.gapsOnlyInSubject} />
          ) : (
            <p className="mt-1.5 text-base text-slate-500">No gap on this side the exemplar doesn&apos;t also carry.</p>
          )}
        </div>
      </div>

      {row.aheadSignals.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-slate-400">
            You have that they don&apos;t ({row.aheadSignals.length})
          </summary>
          <SignalList items={row.aheadSignals} />
        </details>
      )}

      {transfer && <TransferFooter transfer={transfer} />}
    </Surface>
  );
}

function TransferFooter({ transfer }: { transfer: TransferRow }) {
  if (!transfer.practice) return null;
  return (
    <div className="mt-3 rounded-lg border border-accent/20 bg-accent/[0.06] p-3">
      <Kicker tone="accent">What transfers it</Kicker>
      <p className="mt-1.5 text-base leading-relaxed text-slate-300">
        <span className="font-semibold text-white">{transfer.practice.label}</span>: {transfer.practice.what}
      </p>
      {transfer.housePattern && (
        <p className="mt-1.5 text-sm text-slate-400">
          Your org already has a house pattern for this, agreed across{" "}
          <span className="font-mono tabular-nums">{transfer.housePattern.exemplars}</span> repos:{" "}
          {transfer.housePattern.outline.slice(0, 3).join(" · ")}
        </p>
      )}
      {(transfer.applyHref || transfer.skillsHref) && (
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          {transfer.applyHref && (
            <Link href={transfer.applyHref} className="text-accent hover:underline">
              Open in Practices →
            </Link>
          )}
          {transfer.skillsHref && (
            <Link href={transfer.skillsHref} className="text-accent hover:underline">
              Skills →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
