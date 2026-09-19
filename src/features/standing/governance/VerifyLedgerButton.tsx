"use client";

// The Verify action (MC-B14). The only previous reference to verification on this page was a
// non-interactive `<code>` string naming a URL — an examiner was told exactly how to recompute a
// chain and given no way to run it and no rows to run it over.
//
// It is a READ. `/api/audit/verify` no longer seals as a side effect (sealing moved to the daily
// cron), so pressing this cannot change the thing it is checking.

import { useState } from "react";

type Result = { chainOk: boolean; days: number; unsealed: number; backlog: number } | { error: string };

export function VerifyLedgerButton({ slug }: { slug: string }) {
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
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="focus-ring rounded-lg border border-divider px-2.5 py-1 type-body-sm text-slate-200 hover:border-slate-500 disabled:opacity-50"
      >
        {busy ? "Verifying…" : "Verify now"}
      </button>
      {result ? (
        "error" in result ? (
          <span className="type-body-sm text-amber-400">{result.error}</span>
        ) : (
          <span className={`type-body-sm ${result.chainOk ? "text-emerald-400" : "text-red-400"}`}>
            {result.chainOk ? "Chain intact" : "Chain NOT intact"} · {result.days} day
            {result.days === 1 ? "" : "s"} recomputed · {result.unsealed} not yet chained
            {result.backlog > 0 ? ` · ${result.backlog} beyond the next pass` : ""}
          </span>
        )
      ) : null}
    </span>
  );
}
