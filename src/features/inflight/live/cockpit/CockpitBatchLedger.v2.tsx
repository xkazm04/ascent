"use client";

// THE PROPOSED BATCH, Prism composition (v2): a Frame with a section head instead of a hairline caption, the totals as
// evidence (mono), each row's dimension named by its hue. The body is `CockpitBatchTable`, shared with v1, so the
// polarity (a tick KEEPS an item in the run), the pruned/unpaired/broken rows and the inline re-pair are one
// implementation. Same props as v1.
import { DimensionMark, Frame, SectionHead } from "@/components/kit";
import { batchRows, batchTotals } from "./cockpitBatchRows";
import type { CockpitBatchLedgerProps } from "./CockpitBatchLedger";
import { CockpitBatchTable } from "./CockpitBatchTable";

export function CockpitBatchLedgerV2(p: CockpitBatchLedgerProps) {
  const rows = batchRows(p.proposals, p.unpaired, p.dimFocus);
  const t = batchTotals(rows, p.pruned);
  return (
    <Frame aria-label="Proposed batch" pad="md">
      <SectionHead
        eyebrow="Proposed batch"
        title="What the next run would"
        named="work."
        level="section"
        lede="Untick a row to leave it out; the run dispatches what stays."
        actions={
          <p className="type-mono-sm text-slate-400" data-role="batch-totals">
            <span className="tabular-nums text-white">{t.items}</span> item{t.items === 1 ? "" : "s"} ·{" "}
            <span className="tabular-nums">{t.repos}</span> repo{t.repos === 1 ? "" : "s"} ·{" "}
            <span className="tabular-nums text-white">+{t.points}</span> projected
            {t.pruned > 0 && <span className="text-slate-500"> · {t.pruned} pruned</span>}
            {t.unpaired > 0 && <span className="text-warn"> · {t.unpaired} unpaired</span>}
            {t.broken > 0 && <span className="text-warn"> · {t.broken} pairing broken</span>}
          </p>
        }
      />
      <div className="mt-6">
        <CockpitBatchTable p={p} rows={rows} dimMark={(id, label) => <DimensionMark id={id} label={label} />} />
      </div>
    </Frame>
  );
}
