"use client";

// State/effects/handlers for the Credits control popover (CreditsControl.tsx). Owns no JSX — split
// out per docs/ORG-TABS-REFACTOR.md's extraction order to bring CreditsControl.tsx under the 200-LOC
// cap. Public behavior is unchanged: CreditsControl's props/API are untouched, and the opt-in
// low-balance preference still flows through useAutoRechargePref (CreditsControl.autorechargeUi.tsx).

import { useEffect, useId, useRef, useState } from "react";
import type { LedgerEntry } from "./CreditsControl.sections";
import { useAutoRechargePref } from "./CreditsControl.autorechargeUi";

export function useCreditsControl({
  org,
  initialBalance,
  allowanceRemaining,
}: {
  org: string;
  initialBalance: number;
  allowanceRemaining: number;
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

  return {
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
  };
}
