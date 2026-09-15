// The ledger's integrity strip (MC-B14) — the rendered "Ledger integrity: chain verified through …"
// line, the Verify action, and the row export.
//
// It renders in BOTH branches of the card, empty ledger included. The old `<code>` reference lived
// inside the non-empty branch only, so an org with no observations yet was never told the ledger is
// verifiable — which is precisely the org most likely to be evaluating whether it can be.
//
// Server component (the button below it is the only client boundary): the chain read happens on the
// server so the line is present in the HTML a compliance reader screenshots or prints.

import { ledgerIntegrityLine } from "./ledgerIntegrity";
import { VerifyLedgerButton } from "./VerifyLedgerButton";
import type { SealChain } from "@/lib/db/control-observations";

const TONE_CLASS = { good: "text-emerald-400", bad: "text-red-400", unknown: "text-slate-400" } as const;

export function LedgerIntegrityStrip({ slug, chain }: { slug: string; chain: SealChain | null }) {
  const line = ledgerIntegrityLine(chain);
  return (
    <div className="mt-4 rounded-xl border border-divider bg-surface/40 p-4">
      <p className={`type-body-sm ${TONE_CLASS[line.tone]}`}>{line.headline}</p>
      {line.detail ? <p className="mt-1 type-micro text-slate-500">{line.detail}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <VerifyLedgerButton slug={slug} />
        {/* The rows the chain is computed over, in the digest's own field order — so the published
            recipe has something to run on. Before this, `?format=csv` was accepted and answered with
            JSON. */}
        <a
          href={`/api/org/controls?org=${encodeURIComponent(slug)}&format=csv&limit=2000`}
          className="focus-ring rounded-lg border border-divider px-2.5 py-1 type-body-sm text-slate-200 hover:border-slate-500"
        >
          Download observation rows (CSV)
        </a>
      </div>
      <p className="mt-2 type-micro text-slate-500">
        The CSV columns are the digest&apos;s canonical field order, so the recomputation recipe published at{" "}
        <code className="text-slate-400">/api/audit/verify?org={slug}</code> can be run against the download without
        reading any of our code.
      </p>
    </div>
  );
}
