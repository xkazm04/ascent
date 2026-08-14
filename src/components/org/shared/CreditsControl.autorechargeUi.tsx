"use client";

// Low-balance UI for the credits popover — extracted from CreditsControl.tsx to keep the orchestrator
// under the 300-LOC limit. Render-from-props only; all state lives in CreditsControl.
//
// The copy here is deliberately conservative. Nothing in Ascent can charge an org off-session (see
// CreditsControl.autorecharge.ts), so this never promises an automatic purchase — it promises a WARNING
// and gives a one-click way to act on it. `AUTO_RECHARGE_CHARGES_AUTOMATICALLY` is the single switch
// that would let the stronger copy appear.

import { useEffect, useState } from "react";
import type { CreditPack } from "@/lib/polar";
import {
  AUTO_RECHARGE_CHARGES_AUTOMATICALLY,
  DEFAULT_AUTO_RECHARGE,
  normalizeAutoRecharge,
  type AutoRechargePref,
} from "./CreditsControl.autorecharge";

/**
 * The preference's client lifecycle: lazy GET the first time the popover opens, PUT on save.
 *
 * Two rules it exists to keep straight:
 *  - Until the org's real setting is known (and if the read FAILS) the value is the default, which is
 *    OFF. Failing to read a warning preference must never invent a warning.
 *  - A save only takes effect from what the SERVER echoes back. Optimistically adopting the local draft
 *    would show an armed warning that a rejected (e.g. non-owner 403) save never persisted.
 */
export function useAutoRechargePref(org: string, open: boolean) {
  const [pref, setPref] = useState<AutoRechargePref>(DEFAULT_AUTO_RECHARGE);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-open: latch first, load once
    setLoaded(true);
    fetch(`/api/billing/autorecharge?org=${encodeURIComponent(org)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.pref) setPref(normalizeAutoRecharge(d.pref));
      })
      .catch(() => {});
  }, [open, loaded, org]);

  async function save(next: AutoRechargePref) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/autorecharge", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, ...next }),
      });
      const data = (await res.json().catch(() => ({}))) as { pref?: unknown; error?: string };
      if (!res.ok || !data.pref) {
        setError(data.error ?? "Couldn't save.");
        return;
      }
      setPref(normalizeAutoRecharge(data.pref));
    } catch {
      setError("Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return { pref, saving, error, save };
}

/** The pre-emptive warning: balance is still POSITIVE but has reached the org's opt-in line. Its whole
 *  reason to exist is to arrive BEFORE the hard stop, so it leads with what's about to happen ("private
 *  scans pause at 0") and offers the top-up in the same breath. */
export function LowBalanceNotice({
  org,
  balance,
  pref,
  packs,
}: {
  org: string;
  balance: number;
  pref: AutoRechargePref;
  packs: CreditPack[];
}) {
  // The preferred pack when it's still in the catalog, else the first on offer — a saved product id can
  // outlive a POLAR_CREDIT_PACKS change, and a dead id would render a checkout link that 400s.
  const pack = packs.find((p) => p.productId === pref.packProductId) ?? packs[0] ?? null;
  return (
    <div
      className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-sm text-amber-300"
      // Announced when the popover re-reads a balance that has crossed the line mid-session.
      aria-live="polite"
    >
      <p>
        Running low: {balance} {balance === 1 ? "credit" : "credits"} left (your alert is set at{" "}
        {pref.threshold}). Private scans pause at 0.
      </p>
      {pack && (
        <a
          href={`/api/billing/checkout?org=${encodeURIComponent(org)}&pack=${encodeURIComponent(pack.productId)}`}
          className="focus-ring mt-1.5 inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-sm font-medium text-on-accent transition hover:bg-accent-soft"
        >
          Top up {pack.label} <span aria-hidden>→</span>
        </a>
      )}
    </div>
  );
}

/** The opt-in control itself: a checkbox + a threshold number. Saving PUTs to /api/billing/autorecharge
 *  (owner-only server-side; a non-owner gets a 403 surfaced as an inline error rather than a silent no-op). */
export function AutoRechargeSection({
  pref,
  saving,
  error,
  onSave,
}: {
  pref: AutoRechargePref;
  saving: boolean;
  error: string | null;
  onSave: (next: AutoRechargePref) => void;
}) {
  const [enabled, setEnabled] = useState(pref.enabled);
  const [threshold, setThreshold] = useState(String(pref.threshold));

  const parsed = Number.parseInt(threshold, 10);
  const valid = Number.isInteger(parsed) && parsed >= 1;
  const dirty = enabled !== pref.enabled || (valid && parsed !== pref.threshold);

  return (
    <div className="mt-3 border-t border-slate-800 pt-2">
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="focus-ring h-3.5 w-3.5 accent-current"
        />
        Warn me before I run out
      </label>
      {enabled && (
        <div className="mt-1.5 flex items-center gap-2">
          <label htmlFor="ar-threshold" className="text-sm text-slate-400">
            at
          </label>
          <input
            id="ar-threshold"
            type="number"
            min={1}
            inputMode="numeric"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="focus-ring w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-sm text-slate-200"
          />
          <span className="text-sm text-slate-400">credits left</span>
        </div>
      )}
      <p className="mt-1.5 text-sm text-slate-500">
        {AUTO_RECHARGE_CHARGES_AUTOMATICALLY
          ? "Credits are topped up automatically at this balance."
          : // Say the quiet part out loud: no card is on file and nothing buys credits by itself.
            "Ascent can't charge a saved card, so this warns you and offers a one-click top-up; it doesn't buy credits for you."}
      </p>
      <button
        type="button"
        disabled={saving || !dirty || (enabled && !valid)}
        onClick={() => onSave({ enabled, threshold: valid ? parsed : pref.threshold, packProductId: pref.packProductId })}
        className="focus-ring mt-1.5 rounded-md border border-slate-700 px-2.5 py-1 text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      {error && (
        <p className="mt-1 text-sm text-danger" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
