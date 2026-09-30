"use client";

// Prism verify control. Same read of /api/audit/verify as the Altimeter button. The result is a
// glyph and a word: the chain is intact, or it is not. Pressing this does not seal anything.
import { useState } from "react";
import { GhostAction } from "@/components/kit";

type Result = { chainOk: boolean; days: number; unsealed: number; backlog: number } | { error: string };

export function VerifyLedgerButtonV2({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/audit/verify?org=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const body = (await res.json()) as {
        error?: string;
        chainOk?: boolean;
        seals?: unknown[];
        unsealedDays?: unknown[];
        sealBacklogRemaining?: number;
      };
      if (!res.ok || body.error) {
        setResult({ error: body.error ?? `Verification failed (HTTP ${res.status}).` });
      } else {
        setResult({
          chainOk: body.chainOk === true,
          days: body.seals?.length ?? 0,
          unsealed: body.unsealedDays?.length ?? 0,
          backlog: body.sealBacklogRemaining ?? 0,
        });
      }
    } catch {
      setResult({ error: "Could not reach the verifier." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <GhostAction onClick={() => void run()} disabled={busy}>
        {busy ? "Verifying…" : "Verify now"}
      </GhostAction>
      {result ? (
        "error" in result ? (
          <span className="type-body-sm text-slate-200">
            <span aria-hidden>! </span>
            {result.error}
          </span>
        ) : (
          <span className="type-body-sm text-slate-200">
            <span aria-hidden>{result.chainOk ? "✓ " : "▲ "}</span>
            <span className="sr-only">{result.chainOk ? "Healthy: " : "At risk: "}</span>
            {result.chainOk ? "Chain intact" : "Chain NOT intact"} · {result.days} day
            {result.days === 1 ? "" : "s"} recomputed · {result.unsealed} not yet chained
            {result.backlog > 0 ? ` · ${result.backlog} beyond the next pass` : ""}
          </span>
        )
      ) : null}
    </span>
  );
}
