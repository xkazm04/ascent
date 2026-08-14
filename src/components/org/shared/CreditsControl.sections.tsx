"use client";

// Extracted render sections for CreditsControl (see CreditsControl.tsx) — pure relocation to keep
// the orchestrator file under the 300-LOC limit. State stays in CreditsControl; these pieces render
// from props only.

import type { CreditPack } from "@/lib/polar";
import { UNLIMITED_PLAN_LABEL } from "@/lib/plans";

export interface LedgerEntry {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  repoFullName: string | null;
  createdAt: string;
}

export function UnlimitedChip() {
  return (
    // The explanation must not live in `title` alone — title tooltips are unreachable by keyboard
    // and touch, and a non-focusable span gives screen readers only "Credits · Unlimited". An
    // sr-only tail carries the same sentence for AT; `title` stays as the mouse affordance.
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 font-mono text-sm text-emerald-300"
      title={`${UNLIMITED_PLAN_LABEL} plan — private scans are unlimited`}
    >
      Credits · Unlimited
      <span className="sr-only">— {UNLIMITED_PLAN_LABEL} plan, private scans are unlimited</span>
    </span>
  );
}

export function PacksSection({ org, packs }: { org: string; packs: CreditPack[] }) {
  return (
    <div className="mt-3">
      <div className="text-sm text-slate-400">Buy credits</div>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {packs.map((p) => (
          <a
            key={p.productId}
            href={`/api/billing/checkout?org=${encodeURIComponent(org)}&pack=${encodeURIComponent(p.productId)}`}
            className="focus-ring flex items-center justify-between rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition hover:bg-accent-soft"
          >
            <span>{p.label}</span>
            <span aria-hidden>→</span>
          </a>
        ))}
      </div>
    </div>
  );
}

export function GrantSection({
  buyEnabled,
  busy,
  grant,
}: {
  buyEnabled: boolean;
  busy: boolean;
  grant: (amount: number) => void;
}) {
  return (
    <div className="mt-3">
      <div className="text-sm text-slate-400">
        {buyEnabled ? (
          <>Add credits <span className="ml-1 text-slate-600">(dev)</span></>
        ) : (
          // No Polar configured: the grant buttons stand in for a purchase so the
          // upgrade → credits → unlock loop is demoable end-to-end without billing.
          <>Simulate a purchase <span className="ml-1 text-slate-600">(credits)</span></>
        )}
      </div>
      {/* aria-busy while a grant is in flight, matching the disabled visual state for AT. */}
      <div className="mt-1.5 flex gap-2" aria-busy={busy}>
        {[50, 200, 1000].map((a) => (
          <button
            key={a}
            type="button"
            disabled={busy}
            onClick={() => grant(a)}
            className="focus-ring flex-1 rounded-md bg-accent px-2 py-1.5 text-sm font-medium text-on-accent transition hover:bg-accent-soft disabled:opacity-50"
          >
            +{a}
          </button>
        ))}
      </div>
    </div>
  );
}

export function LedgerSection({
  ledgerLoading,
  ledgerError,
  ledger,
  onRetry,
}: {
  ledgerLoading: boolean;
  ledgerError: boolean;
  ledger: LedgerEntry[] | null;
  onRetry: () => void;
}) {
  return (
    <div className="mt-3 border-t border-slate-800 pt-2">
      <div className="text-sm text-slate-500">Recent activity</div>
      {ledgerLoading ? (
        <p className="mt-1 text-sm text-slate-500" aria-live="polite">
          Loading…
        </p>
      ) : ledgerError ? (
        <p className="mt-1 text-sm text-slate-400" aria-live="polite">
          Couldn&apos;t load activity.{" "}
          <button
            type="button"
            onClick={onRetry}
            className="focus-ring rounded-sm text-accent hover:text-white"
          >
            Retry
          </button>
        </p>
      ) : ledger && ledger.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {ledger.slice(0, 5).map((e) => (
            <li key={e.id} className="flex items-center justify-between font-mono text-sm">
              <span className="truncate text-slate-400" title={e.repoFullName ?? e.reason}>
                {e.reason === "scan" ? e.repoFullName ?? "scan" : e.reason}
              </span>
              <span className={e.delta < 0 ? "text-slate-400" : "text-emerald-400"}>
                {e.delta > 0 ? `+${e.delta}` : e.delta}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-slate-500">No activity yet.</p>
      )}
    </div>
  );
}
