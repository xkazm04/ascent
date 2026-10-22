"use client";

// Spend that lands nowhere: measured Claude Code spend on repos AI delivery cannot draw, named with
// its cost and its remedy, and one disclosed one-shot scan for the repos outside the fleet. Renders
// nothing when no measured repo rows exist (unknown is not zero, so no "$0 hidden" line).
import { Caption, PrimaryAction } from "@/components/kit";
import {
  clearLine,
  dollars,
  hiddenLine,
  reconcile,
  remedyText,
  scanDisclosure,
  scanLabel,
  scanPlan,
  type AttributionWire,
  type ReconcileRow,
} from "./attributionReconcileModel";
import { ConnectNotice } from "./ConnectNotice";
import { useAttributionScan, type RepoOutcome } from "./useAttributionScan";

export function AttributionReconcile({ slug, attribution }: { slug: string; attribution: AttributionWire | null | undefined }) {
  if (!attribution) return null;
  return <Reconcile slug={slug} attribution={attribution} />;
}

function Reconcile({ slug, attribution }: { slug: string; attribution: AttributionWire }) {
  const rec = reconcile(attribution);
  const plan = scanPlan(slug, rec.rows);
  const scan = useAttributionScan(plan);
  if (rec.state === "none") return null;
  const over = rec.windowTitle ? ` ${rec.windowTitle}.` : "";

  if (rec.state === "clear") {
    return (
      <section data-role="attribution-reconcile" data-state="clear" aria-label="Where measured spend lands">
        <p className="type-body-sm text-slate-400">
          {clearLine(rec)}
          {over}
        </p>
      </section>
    );
  }

  const hidden = rec.rows.filter((row) => row.bucket !== "landed");
  return (
    <section data-role="attribution-reconcile" data-state="hidden" aria-label="Where measured spend lands" className="space-y-3">
      <ConnectNotice ok={false} text={hiddenLine(rec) ?? ""} note={`Counted over measured Claude Code spend per repository.${over}`} />
      <ul className="space-y-2">
        {hidden.map((row) => (
          <HiddenRow key={row.repo} row={row} outcome={scan.outcomes[row.repo]} />
        ))}
      </ul>
      {plan ? (
        <div className="space-y-2">
          <Caption>{scanDisclosure(plan)}</Caption>
          <PrimaryAction onClick={() => void scan.run()} disabled={scan.phase === "running"}>
            {scan.phase === "running" ? "Scanning…" : scanLabel(plan)}
          </PrimaryAction>
        </div>
      ) : (
        <Caption>Nothing here can be scanned from this page yet.</Caption>
      )}
      {scan.phase === "done" && <ConnectNotice ok text="Scan finished. The list re-reads what AI delivery can now show." note={scan.message ?? undefined} />}
      {scan.phase === "failed" && <ConnectNotice ok={false} text={scan.message ?? "Scan failed."} />}
    </section>
  );
}

const OUTCOME_WORD: Record<RepoOutcome, string> = { scanned: "scanned", skipped: "skipped (credits)", failed: "failed" };

function HiddenRow({ row, outcome }: { row: ReconcileRow; outcome: RepoOutcome | undefined }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-mono type-body-sm text-slate-100">{row.repo}</span>
      <span className="type-body-sm tabular-nums text-slate-300">{dollars(row.costCents)}</span>
      <span className="type-body-sm text-slate-400">{remedyText(row.action)}</span>
      {outcome ? <span className="type-body-sm text-slate-300">{OUTCOME_WORD[outcome]}</span> : null}
    </li>
  );
}
