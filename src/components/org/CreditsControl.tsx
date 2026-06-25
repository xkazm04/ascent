"use client";

// Org dashboard credits chip + top-up popover. Shows the prepaid private-scan balance ("Unlimited"
// for the enterprise plan) and, for owners on a deployment where manual grants are enabled
// (ASCENT_ALLOW_CREDIT_GRANTS), quick top-up buttons that POST /api/org/credits/grant. Where grants
// are disabled (production), it explains that top-ups go through billing. The recent ledger is loaded
// lazily when the popover opens. Server passes the initial balance so the chip paints without a fetch.

import { useEffect, useRef, useState } from "react";

interface LedgerEntry {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  repoFullName: string | null;
  createdAt: string;
}

/** A purchasable credit pack passed from the server (mirrors lib/polar CreditPack; declared locally so
 *  this client component never bundles the Polar SDK that lib/polar imports). */
interface Pack {
  productId: string;
  credits: number;
  label: string;
}

export function CreditsControl({
  org,
  initialBalance,
  unlimited,
  grantsEnabled,
  buyEnabled = false,
  packs = [],
}: {
  org: string;
  initialBalance: number;
  unlimited: boolean;
  grantsEnabled: boolean;
  buyEnabled?: boolean;
  packs?: Pack[];
}) {
  const [balance, setBalance] = useState(initialBalance);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — standard popover behavior.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Load the ledger the first time the popover opens.
  useEffect(() => {
    if (!open || ledger !== null) return;
    fetch(`/api/org/credits?org=${encodeURIComponent(org)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLedger(d?.ledger ?? []))
      .catch(() => setLedger([]));
  }, [open, ledger, org]);

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

  const low = balance <= 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-sm transition ${
          low
            ? "border-amber-500/50 bg-amber-500/10 text-amber-300 hover:border-amber-400"
            : "border-slate-700 text-slate-300 hover:border-accent hover:text-white"
        }`}
        title="Prepaid private-scan credits"
      >
        <span className="font-semibold">{balance}</span> credits
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Scan credits"
          className="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-slate-800 bg-slate-950 p-4 shadow-2xl"
        >
          <div className="font-mono text-sm uppercase tracking-widest text-accent">Scan credits</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white">{balance}</span>
            <span className="text-sm text-slate-400">private scans remaining</span>
          </div>
          {low && (
            <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-sm text-amber-300">
              Out of credits — private scans are paused until you top up.
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

          {ledger && ledger.length > 0 && (
            <div className="mt-3 border-t border-slate-800 pt-2">
              <div className="text-sm text-slate-500">Recent activity</div>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
