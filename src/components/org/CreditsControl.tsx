"use client";

// Org dashboard credits chip + top-up popover. Shows the prepaid private-scan balance ("Unlimited"
// for the enterprise plan) and, for owners on a deployment where manual grants are enabled
// (ASCENT_ALLOW_CREDIT_GRANTS), quick top-up buttons that POST /api/org/credits/grant. Where grants
// are disabled (production), it explains that top-ups go through billing. The recent ledger is loaded
// lazily when the popover opens. Server passes the initial balance so the chip paints without a fetch.

import { useEffect, useRef, useState } from "react";
import type { CreditPack } from "@/lib/polar";

interface LedgerEntry {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  repoFullName: string | null;
  createdAt: string;
}

// The purchasable credit-pack shape is `CreditPack` from @/lib/polar. It's imported type-only, so the
// TS/SWC compiler fully erases the import — this client component never pulls lib/polar (or the Polar
// SDK it requires) into its bundle, while the pack shape stays single-sourced with the server.

export function CreditsControl({
  org,
  initialBalance,
  unlimited,
  grantsEnabled,
  buyEnabled = false,
  packs = [],
  allowanceRemaining = 0,
}: {
  org: string;
  initialBalance: number;
  unlimited: boolean;
  grantsEnabled: boolean;
  buyEnabled?: boolean;
  packs?: CreditPack[];
  /** Free metered scans LEFT in the plan's monthly allowance (from checkScanEntitlement). While this
   *  is > 0, a 0 prepaid balance does NOT pause scanning — the allowance still covers them. */
  allowanceRemaining?: number;
}) {
  const [balance, setBalance] = useState(initialBalance);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  // Distinguish "loading" and "load failed" from "no activity yet" — collapsing all of them into an
  // empty ledger made a 503/403/network error masquerade as an empty (successful) ledger on a money screen.
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — standard popover behavior. On Escape, return focus to the
  // trigger so a keyboard/screen-reader user isn't dropped back at <body> (the role="dialog" promises it).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Move focus into the dialog when it opens, so the popover content is where a keyboard/AT user lands.
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  // Load the ledger the first time the popover opens, tracking loading + a distinct error state. The
  // `ledgerError` guard stops the effect re-firing in a loop while ledger stays null after a failure;
  // the Retry button clears it to re-trigger.
  useEffect(() => {
    if (!open || ledger !== null || ledgerLoading || ledgerError) return;
    setLedgerLoading(true);
    fetch(`/api/org/credits?org=${encodeURIComponent(org)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setLedger(d?.ledger ?? []))
      .catch(() => setLedgerError(true))
      .finally(() => setLedgerLoading(false));
  }, [open, ledger, ledgerLoading, ledgerError, org]);

  async function grant(amount: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/credits/grant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, amount }),
      });
      const data = (await res.json().catch(() => ({}))) as { balance?: number; error?: string };
      if (!res.ok || typeof data.balance !== "number") {
        setError(data.error ?? "Top-up failed.");
        return;
      }
      setBalance(data.balance);
      setLedger(null); // force a ledger refresh on next view
      setLedgerError(false);
    } catch {
      setError("Top-up failed.");
    } finally {
      setBusy(false);
    }
  }

  if (unlimited) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 font-mono text-sm text-emerald-300"
        title="Enterprise plan — private scans are unlimited"
      >
        Credits · Unlimited
      </span>
    );
  }

  // A 0 prepaid balance only PAUSES scanning when the monthly free allowance is also spent. While the
  // allowance still covers scans, consumeScanCredit charges nothing (charge === "allowance"), so the
  // chip must not cry "out of credits / paused" — that falsely nudges toward unnecessary top-ups.
  const freeScansLeft = Math.max(0, allowanceRemaining);
  const paused = balance <= 0 && freeScansLeft <= 0;
  const coveredByAllowance = balance <= 0 && freeScansLeft > 0;

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-sm transition ${
          paused
            ? "border-amber-500/50 bg-amber-500/10 text-amber-300 hover:border-amber-400"
            : "border-slate-700 text-slate-300 hover:border-accent hover:text-white"
        }`}
        title="Prepaid private-scan credits"
      >
        <span className="font-semibold">{balance}</span> credits
      </button>

      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-label="Scan credits"
          tabIndex={-1}
          className="focus-ring absolute right-0 z-40 mt-2 w-72 rounded-xl border border-slate-800 bg-slate-950 p-4 shadow-2xl"
        >
          <div className="font-mono text-sm uppercase tracking-widest text-accent">Scan credits</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white">{balance}</span>
            <span className="text-sm text-slate-400">private scans remaining</span>
          </div>
          {paused && (
            <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-sm text-amber-300">
              Out of credits — private scans are paused until you top up.
            </p>
          )}
          {coveredByAllowance && (
            <p className="mt-2 rounded-md border border-slate-700 bg-slate-800/40 px-2.5 py-1.5 text-sm text-slate-300">
              {freeScansLeft} free {freeScansLeft === 1 ? "scan" : "scans"} left this month — scans
              keep running on your monthly allowance.
            </p>
          )}

          {buyEnabled && packs.length > 0 && (
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
          )}

          {grantsEnabled && (
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
              <div className="mt-1.5 flex gap-2">
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
          )}

          {!buyEnabled && !grantsEnabled && (
            <p className="mt-3 text-sm text-slate-400">
              Top-ups are handled by billing.{" "}
              <a href="/pricing" className="text-accent hover:text-white">
                See plans →
              </a>
            </p>
          )}
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}

          {(ledgerLoading || ledgerError || ledger !== null) && (
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
                    onClick={() => setLedgerError(false)}
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
          )}
        </div>
      )}
    </div>
  );
}
