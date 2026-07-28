"use client";

// Org dashboard credits chip + top-up popover. Shows the prepaid private-scan balance ("Unlimited"
// for the enterprise plan) and, for owners on a deployment where manual grants are enabled
// (ASCENT_ALLOW_CREDIT_GRANTS), quick top-up buttons that POST /api/org/credits/grant. Where grants
// are disabled (production), it explains that top-ups go through billing. The recent ledger is loaded
// lazily when the popover opens. Server passes the initial balance so the chip paints without a fetch.
//
// It also carries the opt-in LOW-BALANCE warning (the honest half of "auto-recharge"): a pre-emptive
// notice + one-click top-up while the balance is still positive, driven by a per-org threshold. Nothing
// here charges anyone — see CreditsControl.autorecharge.ts for why that is not possible today.

import { useEffect, useId, useRef, useState } from "react";
import type { CreditPack } from "@/lib/polar";
import {
  GrantSection,
  LedgerSection,
  PacksSection,
  UnlimitedChip,
  type LedgerEntry,
} from "./CreditsControl.sections";
import { creditPressure } from "./CreditsControl.autorecharge";
import {
  AutoRechargeSection,
  LowBalanceNotice,
  useAutoRechargePref,
} from "./CreditsControl.autorechargeUi";

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
  // Live copy of the monthly free allowance, seeded from the SSR prop and reconciled by the popover
  // fetch alongside `balance` — the paused/covered-by-allowance state machine derives from BOTH inputs,
  // so refreshing only one left the pause messaging frozen at page-load truth all session.
  const [allowanceLeft, setAllowanceLeft] = useState(allowanceRemaining);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  // Distinguish "loading" and "load failed" from "no activity yet" — collapsing all of them into an
  // empty ledger made a 503/403/network error masquerade as an empty (successful) ledger on a money screen.
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState(false);
  // Opt-in low-balance preference (see CreditsControl.autorecharge.ts) — loaded lazily when the popover
  // first opens, defaulting to OFF until the org's real setting is known.
  const { pref, saving: prefSaving, error: prefError, save: savePref } = useAutoRechargePref(org, open);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Accessible DESCRIPTION for the trigger — the "prepaid private-scan credits" meaning must not live
  // in `title` alone (unreachable by keyboard/touch and unreliable for AT). aria-describedby keeps the
  // accessible NAME the visible "{balance} credits" while screen readers announce the description.
  const descId = useId();

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-open: raise the loading flag, then load the ledger once
    setLedgerLoading(true);
    fetch(`/api/org/credits?org=${encodeURIComponent(org)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        setLedger(d?.ledger ?? []);
        // Reconcile the chip from the AUTHORITATIVE server balance the SAME response already carries.
        // `balance` was seeded once from SSR initialBalance and only bumped by local grants, so after
        // private scans spent credits elsewhere this session it showed a stale, too-high number that the
        // freshly-loaded ledger's newest balanceAfter visibly contradicted. Opening the popover — the one
        // place that re-reads the truth — now self-heals it instead of throwing d.balance away.
        if (typeof d?.balance === "number") setBalance(d.balance);
        // Reconcile the allowance the SAME way — `paused` / `coveredByAllowance` derive from balance
        // AND allowanceRemaining, so healing only the balance kept stale "N free scans left — scans
        // keep running" (or a stale "paused" nudge after the month rolled over) all session. The route
        // serializes Infinity as null, but null only occurs with `unlimited`, which renders a
        // different branch entirely — so a non-number here safely means 0.
        if (d) setAllowanceLeft(typeof d.allowanceRemaining === "number" ? d.allowanceRemaining : 0);
      })
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
    return <UnlimitedChip />;
  }

  // A 0 prepaid balance only PAUSES scanning when the monthly free allowance is also spent. While the
  // allowance still covers scans, consumeScanCredit charges nothing (charge === "allowance"), so the
  // chip must not cry "out of credits / paused" — that falsely nudges toward unnecessary top-ups.
  //
  // `low` is the new PRE-EMPTIVE state (still positive, at/below the org's opt-in line) — it exists only
  // when the org enabled it, so with the feature off creditPressure returns exactly the paused/covered/ok
  // this file computed before.
  const freeScansLeft = Math.max(0, allowanceLeft);
  const pressure = creditPressure({ balance, allowanceRemaining: freeScansLeft, pref });
  const paused = pressure === "paused";
  const coveredByAllowance = pressure === "covered";

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          // Reset a stale grant error when (re)opening — a failed top-up used to leave "Top-up failed."
          // pinned inside the popover, so closing and reopening it showed a fresh dialog still accusing
          // the user of a failure that belonged to the previous session.
          if (!open) setError(null);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        // WCAG 1.4.1 (use of color): the paused state can't be signalled by the amber tint ALONE — a
        // colorblind or screen-reader user would get no cue that private scanning is stopped until they
        // discover and open the popover. Add a text/glyph marker AND an explicit aria-label so the status
        // survives without color; the amber styling stays as reinforcement, not the sole signal.
        aria-label={paused ? `${balance} credits — out of credits, private scanning paused` : undefined}
        className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-sm transition ${
          paused
            ? "border-amber-500/50 bg-amber-500/10 text-amber-300 hover:border-amber-400"
            : "border-slate-700 text-slate-300 hover:border-accent hover:text-white"
        }`}
        title="Prepaid private-scan credits"
        aria-describedby={descId}
      >
        <span className="font-semibold">{balance}</span> credits
        {paused && (
          <span className="inline-flex items-center gap-0.5">
            <span aria-hidden>⚠</span> paused
          </span>
        )}
      </button>
      <span id={descId} className="sr-only">
        Prepaid private-scan credits
      </span>

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
              {freeScansLeft} free {freeScansLeft === 1 ? "scan" : "scans"} left this month (resets on
              the 1st, UTC) — scans keep running on your monthly allowance.
            </p>
          )}

          {pressure === "low" && (
            <LowBalanceNotice org={org} balance={balance} pref={pref} packs={buyEnabled ? packs : []} />
          )}

          {buyEnabled && packs.length > 0 && <PacksSection org={org} packs={packs} />}

          {grantsEnabled && <GrantSection buyEnabled={buyEnabled} busy={busy} grant={grant} />}

          {!buyEnabled && !grantsEnabled && (
            <p className="mt-3 text-sm text-slate-400">
              Top-ups are handled by billing.{" "}
              <a href="/pricing" className="text-accent hover:text-white">
                See plans →
              </a>
            </p>
          )}
          {/* aria-live so a failed top-up is ANNOUNCED, matching the ledger states' live regions — a
              screen-reader user who presses +50 must not get silence on a payment-adjacent failure. */}
          {error && (
            <p className="mt-2 text-sm text-danger" aria-live="polite">
              {error}
            </p>
          )}

          {/* `key` re-seeds the section's local draft when the stored preference arrives (or changes),
              so the checkbox/threshold never sit on a value the server has since superseded. */}
          <AutoRechargeSection
            key={`${pref.enabled}:${pref.threshold}`}
            pref={pref}
            saving={prefSaving}
            error={prefError}
            onSave={savePref}
          />

          {(ledgerLoading || ledgerError || ledger !== null) && (
            <LedgerSection
              ledgerLoading={ledgerLoading}
              ledgerError={ledgerError}
              ledger={ledger}
              onRetry={() => setLedgerError(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
