// The retention card's read-outs: the last-purge receipt strip, and the dry-run delta table (what the
// policy in force deletes, what the draft deletes, what the edit adds) with the preview's errors.
// No hooks: rendered inside the client RetentionCard, so it needs no "use client" of its own.

import { formatDelta, type Measure, type RetentionPreviewModel } from "./retentionPreviewModel";
import type { ReceiptModel } from "./retentionReceiptModel";

function show(m: Measure): string {
  return m === "unknown" ? "unknown" : String(m);
}

export function RetentionReceiptStrip({ receipt }: { receipt: ReceiptModel }) {
  const tone = receipt.state === "applied" ? "text-slate-300" : "text-slate-400";
  return (
    <p data-testid="retention-receipt" data-state={receipt.state} className={`mt-3 type-body-sm ${tone}`}>
      {receipt.text}
      {receipt.saved ? <span className="text-slate-500">{` · ${receipt.saved}`}</span> : null}
    </p>
  );
}

export function RetentionPreviewPanel({ model, errors }: { model: RetentionPreviewModel; errors: string[] }) {
  return (
    <div data-testid="retention-preview-panel" data-state={model.state} className="mt-4">
      {errors.length > 0 && (
        <p role="alert" className="mb-2 type-body-sm text-orange-300">
          {`The preview reported ${errors.length === 1 ? "an error" : `${errors.length} errors`}: ${errors.join("; ")}`}
        </p>
      )}
      {model.state === "unknown" ? (
        <p className="type-body-sm text-orange-200">
          The preview could not be counted. Nothing is shown as zero; preview again before saving.
        </p>
      ) : (
        <table className="w-full max-w-2xl type-body-sm text-slate-300">
          <caption className="mb-2 text-left type-mono-sm text-slate-500">
            Rows the next purge deletes: under the policy in force, under this draft, and what the edit adds
          </caption>
          <thead>
            <tr className="text-left type-mono-sm text-slate-500">
              <th scope="col" className="py-1 font-normal">Ledger</th>
              <th scope="col" className="py-1 text-right font-normal">Now</th>
              <th scope="col" className="py-1 text-right font-normal">Proposed</th>
              <th scope="col" className="py-1 text-right font-normal">Edit adds</th>
            </tr>
          </thead>
          {model.groups.map((g) => (
            <tbody key={g.title}>
              <tr>
                <th scope="rowgroup" colSpan={4} className="pt-2 text-left type-mono-sm font-normal text-slate-500">{g.title}</th>
              </tr>
              {g.rows.map((r) => (
                <tr key={r.key} data-testid={`retention-row-${r.key}`} data-state={r.state} title={r.hint}>
                  <th scope="row" className="py-0.5 text-left font-normal">{r.label}</th>
                  <td className="py-0.5 text-right">{show(r.now)}</td>
                  <td className="py-0.5 text-right">{show(r.proposed)}</td>
                  <td className={`py-0.5 text-right ${typeof r.delta === "number" && r.delta > 0 ? "text-orange-200" : ""}`}>
                    {formatDelta(r.delta)}
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      )}
    </div>
  );
}
