// One audit entry for the "Prompt audit" variant — a repo's context file marked up like a
// copy-edit desk would mark a manuscript: a graded stamp, a signal/noise split of the prose, and
// the three quality axes broken out as sub-meters.
//
// Extracted from ContextPromptAudit.tsx to keep both files well under the 300-LOC cap.

import Link from "next/link";
import { MeterRow } from "@/components/org/shared/ui";
import { scoreHex, scoreGlyph, fmtCompact } from "@/lib/ui";
import { PROVENANCE_LABEL, USABLE_QUALITY, type ContextProvenance, type RepoContextHealth } from "./contextHealthMock";

/** Provenance stamp — the research's sharpest single finding rendered as a verdict, not a chip.
 *  Human-curated is an asset; LLM-generated is a liability and is styled as one. */
export function ProvenanceStamp({ provenance }: { provenance: ContextProvenance }) {
  const tone =
    provenance === "human"
      ? "border-success/40 text-success-soft"
      : provenance === "mixed"
        ? "border-slate-700 text-slate-300"
        : provenance === "generated"
          ? "border-danger/40 text-danger"
          : "border-slate-800 text-slate-600";
  return (
    <span className={`inline-flex shrink-0 items-center rounded border px-2 py-0.5 font-mono text-xs uppercase tracking-[0.18em] ${tone}`}>
      {PROVENANCE_LABEL[provenance]}
    </span>
  );
}

/** The signal/noise split: how much of this context file is load-bearing guidance vs boilerplate,
 *  stale assertions, and machine filler. One bar, two truths — the variant's central image. */
export function SignalNoiseBar({ r }: { r: RepoContextHealth }) {
  const signal = r.present ? Math.round((r.quality / 100) * r.specificity) : 0;
  const noise = Math.max(0, 100 - signal);
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-800" role="img" aria-label={`${r.name}: ${signal}% signal, ${noise}% noise`}>
        <div style={{ width: `${signal}%`, backgroundColor: scoreHex(r.quality) }} />
        <div className="bg-[repeating-linear-gradient(45deg,#1e293b,#1e293b_3px,#0f172a_3px,#0f172a_6px)]" style={{ width: `${noise}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-xs uppercase tracking-[0.18em] text-slate-600">
        <span>
          Signal <span className="tabular-nums text-slate-300">{signal}%</span>
        </span>
        <span>
          Noise <span className="tabular-nums text-slate-500">{noise}%</span>
        </span>
      </div>
    </div>
  );
}

export function AuditEntry({ r }: { r: RepoContextHealth }) {
  const hex = r.present ? scoreHex(r.quality) : "#334155";
  const covPct = Math.round((r.coverage.covered / Math.max(1, r.coverage.total)) * 100);
  return (
    <article className="grid gap-5 bg-ink px-5 py-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden className="font-mono text-lg leading-none" style={{ color: hex }}>
            {r.present ? scoreGlyph(r.quality) : "○"}
          </span>
          {r.present ? (
            <Link href={`/report/${r.fullName}`} className="truncate font-mono text-sm text-white hover:text-accent">
              {r.fullName}
            </Link>
          ) : (
            <span className="truncate font-mono text-sm text-slate-400">{r.fullName}</span>
          )}
          <ProvenanceStamp provenance={r.provenance} />
        </div>
        <p className="mt-1.5 text-base text-slate-300">{r.verdict}</p>
        <p className="mt-1 font-mono text-xs uppercase tracking-[0.18em] text-slate-600">
          {r.present
            ? `${r.primary?.path} · ${fmtCompact(r.primary?.bytes ?? 0)}b · edited ${r.ageDays}d ago · ${fmtCompact(r.churnSinceEdit)} commits since`
            : `${r.commitsPerWeek}/wk landing with no guidance`}
        </p>
      </div>

      <div className="space-y-2.5">
        <SignalNoiseBar r={r} />
        <MeterRow layout="labelled" label="Repo-specificity" value={r.specificity} display={`${r.specificity}`} color={scoreHex(r.specificity)} labelClassName="w-32 shrink-0 text-slate-400" />
        <MeterRow layout="labelled" label="Still current" value={r.potency} display={`${r.potency}`} color={scoreHex(r.potency)} labelClassName="w-32 shrink-0 text-slate-400" />
        <MeterRow
          layout="labelled"
          label="Areas described"
          value={covPct}
          display={`${r.coverage.covered}/${r.coverage.total}`}
          color={scoreHex(covPct)}
          labelClassName="w-32 shrink-0 text-slate-400"
          valueClassName="w-12 font-mono text-sm text-slate-500"
        />
      </div>
    </article>
  );
}

/** The desk's verdict line for the whole fleet — what an editor would write at the top of the proof. */
export function auditVerdict(withContext: number, usable: number, generated: number): string {
  if (withContext === 0) return "Nothing to audit — no repo publishes agent context.";
  const hollow = withContext - usable;
  const parts = [`${usable} of ${withContext} context files clear the bar (≥${USABLE_QUALITY})`];
  if (hollow > 0) parts.push(`${hollow} are present but hollow`);
  if (generated > 0) parts.push(`${generated} read as machine-written and are costing you accuracy`);
  return `${parts.join(" · ")}.`;
}
