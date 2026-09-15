"use client";

// The owner's DECLINE affordance on the passport card — "I have seen this gap and I am deliberately
// living with it" — beside PassportOwnerControls.
//
// Why this exists: PATCH /api/report/passport/overrides (the decline write) had ZERO callers. Every
// decline-rendering surface in the product — the hero strip, the fleet DeclinedList, the Pareto's
// hollow marks, the re-confirmation prompts — was fed by data no human could enter anywhere in the
// product. The passport claimed to hold decision memory while offering no way to record a decision.
//
// Two rules the control is built around:
//   • Only findings the scan actually RAISED are offered (see passportDeclineOffers): a "we could not
//     see this" caveat is a limitation of the evidence, never a trade-off an owner may accept.
//   • A reason is REQUIRED. An accepted gap with no rationale teaches the next reader nothing, and the
//     whole point of a decline is that it reads as a decision rather than an unread finding.
// The author and the date are stamped server-side by the route; the client never sends them.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { declineOffers, type DeclineOffer } from "./passportDeclineOffers";
import type { AppPassport } from "@/lib/types";

const BTN = "focus-ring rounded-md border px-2.5 py-1 type-caption transition disabled:opacity-50";
const IDLE = "border-slate-700 text-slate-400 hover:border-accent hover:text-white";

export function PassportDeclineControl({ repo, passport }: { repo: string; passport: AppPassport }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [why, setWhy] = useState("");

  const offers = declineOffers(passport);
  const declined = passport.declined ?? [];
  const working = busy !== null || pending;

  async function send(path: string, body: Record<string, unknown> | null) {
    setBusy(path);
    setError(null);
    const res = await fetch("/api/report/passport/overrides", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo, declined: { [path]: body } }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setError((await res?.json().catch(() => null))?.error ?? "Couldn't record that. Try again.");
      return;
    }
    setDrafting(null);
    setWhy("");
    startTransition(() => router.refresh()); // re-read with the overlay applied
  }

  if (offers.length === 0 && declined.length === 0) return null;

  return (
    <div className="mt-4 border-t border-slate-800 pt-4" data-testid="passport-decline-control">
      <div className="type-mono-sm uppercase tracking-widest text-slate-500">Accept a gap</div>
      <p className="mt-1 type-body-sm text-slate-500">
        Deliberately living with one of these? Record why. It never moves a score — it turns an unread
        finding into a decision, with your name on it. Only gaps this scan actually observed can be
        accepted.
      </p>

      {offers.length > 0 && (
        <ul className="mt-3 space-y-2">
          {offers.map((o) => (
            <li key={o.path} className="type-body-sm">
              <OfferRow
                offer={o}
                drafting={drafting === o.path}
                why={why}
                working={working}
                onWhy={setWhy}
                onOpen={() => {
                  setDrafting(o.path);
                  setWhy("");
                }}
                onCancel={() => setDrafting(null)}
                onSubmit={() => send(o.path, { reason: why, code: o.code, severity: o.severity })}
              />
            </li>
          ))}
        </ul>
      )}

      {declined.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {declined.map((d) => (
            <li key={d.path} className="flex flex-wrap items-baseline gap-x-2 type-caption text-slate-500">
              <span aria-hidden className="text-slate-600">◇</span>
              <span className="text-slate-300">{d.label}</span>
              <span className="text-slate-600">
                declined by {d.by ?? "unknown"}
                {d.at ? ` on ${d.at}` : ""}
              </span>
              <button
                type="button"
                disabled={working}
                onClick={() => send(d.path, null)}
                className={`${BTN} ${IDLE}`}
                aria-label={`Retract the decline of ${d.label}`}
              >
                Retract
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 type-body-sm text-orange-300">{error}</p>}
    </div>
  );
}

/** One offered gap: the finding, and either the "Accept" affordance or the reason draft. */
function OfferRow({
  offer,
  drafting,
  why,
  working,
  onWhy,
  onOpen,
  onCancel,
  onSubmit,
}: {
  offer: DeclineOffer;
  drafting: boolean;
  why: string;
  working: boolean;
  onWhy: (v: string) => void;
  onOpen: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex gap-2">
        <span aria-hidden className="mt-0.5 shrink-0 text-orange-400/70">▸</span>
        <span className="min-w-0">
          <span className="text-slate-300">{offer.text}</span>
          {offer.reconfirm && (
            <span className="ml-2 rounded border border-amber-500/40 px-1.5 py-0.5 font-mono type-micro uppercase tracking-widest text-amber-400">
              re-confirm
            </span>
          )}
          {offer.reconfirmReason && <span className="mt-0.5 block type-caption text-amber-400/90">{offer.reconfirmReason}</span>}
        </span>
      </span>
      {drafting ? (
        <div className="ml-4 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`decline-why-${offer.path}`}>
            Why are you accepting {offer.label}?
          </label>
          <input
            id={`decline-why-${offer.path}`}
            value={why}
            autoFocus
            onChange={(e) => onWhy(e.target.value)}
            placeholder="Why is this acceptable here? (the next reader sees this)"
            className="focus-ring min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 type-body-sm text-white placeholder:text-slate-600"
          />
          <button type="button" disabled={working || !why.trim()} onClick={onSubmit} className={`${BTN} border-accent/60 text-white hover:bg-accent/10`}>
            {offer.reconfirm ? "Re-confirm" : "Accept gap"}
          </button>
          <button type="button" disabled={working} onClick={onCancel} className={`${BTN} ${IDLE}`}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="ml-4">
          <button type="button" disabled={working} onClick={onOpen} className={`${BTN} ${IDLE}`}>
            {offer.reconfirm ? `Re-confirm ${offer.label}` : `Accept ${offer.label}`}
          </button>
        </div>
      )}
    </div>
  );
}
