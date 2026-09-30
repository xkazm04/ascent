// Chain status as a glyph and the existing sentence, not a green or red line. The verify button and
// the CSV download are the same actions as the Altimeter strip.
import { GhostAction } from "@/components/kit";
import { VerifyLedgerButton } from "./VerifyLedgerButton";
import { ledgerIntegrityLine } from "./ledgerIntegrity";
import type { SealChain } from "@/lib/db/control-observations";

const MARK = {
  good: { glyph: "✓", word: "Healthy" },
  bad: { glyph: "▲", word: "At risk" },
  unknown: { glyph: "◆", word: "Unknown" },
} as const;

export function LedgerIntegrityV2({ slug, chain }: { slug: string; chain: SealChain | null }) {
  const line = ledgerIntegrityLine(chain);
  const mark = MARK[line.tone];
  return (
    <div className="mt-6 border-t border-divider pt-4">
      <p className="type-body text-slate-200">
        <span aria-hidden className="mr-2">
          {mark.glyph}
        </span>
        <span className="sr-only">{mark.word}: </span>
        {line.headline}
      </p>
      {line.detail ? <p className="mt-1 type-body-sm text-slate-400">{line.detail}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <VerifyLedgerButton slug={slug} />
        <GhostAction href={`/api/org/controls?org=${encodeURIComponent(slug)}&format=csv&limit=2000`}>
          Download observation rows (CSV)
        </GhostAction>
      </div>
      <p className="mt-2 max-w-[46rem] type-body-sm text-slate-400">
        The CSV columns are the digest&apos;s canonical field order, so the recomputation recipe published at{" "}
        <code className="text-slate-300">/api/audit/verify?org={slug}</code> can be run against the download without
        reading any of our code.
      </p>
    </div>
  );
}
