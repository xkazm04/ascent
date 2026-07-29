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
//
// State/effects/handlers live in useCreditsControl.ts — this file is JSX only. Public props are
// unchanged (a sibling reads the auto-recharge preference through CreditsControl.autorechargeUi's
// accessor, so its shape must not move).

import type { CreditPack } from "@/lib/polar";
import { GrantSection, LedgerSection, PacksSection, UnlimitedChip } from "./CreditsControl.sections";
import { creditPressure } from "./CreditsControl.autorecharge";
import { AutoRechargeSection, LowBalanceNotice } from "./CreditsControl.autorechargeUi";
import { useCreditsControl } from "./useCreditsControl";

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
  const {
    balance,
    allowanceLeft,
    open,
    setOpen,
    busy,
    error,
    setError,
    ledger,
    ledgerLoading,
    ledgerError,
    setLedgerError,
    pref,
    prefSaving,
    prefError,
    savePref,
    ref,
    triggerRef,
    dialogRef,
    descId,
    grant,
  } = useCreditsControl({ org, initialBalance, allowanceRemaining });

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
