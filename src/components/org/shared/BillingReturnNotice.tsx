"use client";

// Post-checkout return notice (checkout-plans-polar 2026-07-16 #1). /api/billing/checkout 303s the
// returning buyer to /org/<slug>?credits=pending (payment made, fulfilment webhook-async) or
// ?credits=error (session creation failed, nothing charged). The param was produced but consumed
// NOWHERE — the single most anxious moment in the product (money left the account, entitlement not
// yet visible) rendered a dashboard identical to any other, so buyers double-purchased or churned
// on a silently-dead checkout click. This banner is that missing consumer.
//
// Dismiss strips the param via router.replace(dismissHref) — built server-side from the remaining
// search params — so a reload/share of the URL doesn't resurrect a stale notice.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BillingReturnNotice({
  status,
  dismissHref,
}: {
  /** `pending` = payment received, credits/plan land when the Polar webhook fulfils (typically <1min).
   *  `error` = the checkout session couldn't be created — the user was NOT charged. */
  status: "pending" | "error";
  /** The current URL with the `credits` param stripped (other params preserved). */
  dismissHref: string;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const pending = status === "pending";
  const dismiss = () => {
    setDismissed(true); // hide immediately; the replace then makes it durable
    router.replace(dismissHref, { scroll: false });
  };

  return (
    <div
      // Payment-outcome feedback must be announced: status (polite) for the reassuring pending case,
      // alert for the failed checkout.
      role={pending ? "status" : "alert"}
      className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
        pending
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          : "border-danger/40 bg-danger/10 text-danger-soft"
      }`}
    >
      <p>
        {pending ? (
          <>
            <strong>Payment received.</strong> Your credits or plan upgrade will appear here within a
            minute. The balance updates as soon as the payment is confirmed.
          </>
        ) : (
          <>
            <strong>Checkout couldn&apos;t be started.</strong> You were <strong>not charged</strong>.
            Please try again from the credits menu or the pricing page.
          </>
        )}
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss billing notice"
        className={`focus-ring shrink-0 rounded-md border px-2 py-0.5 text-xs transition ${
          pending
            ? "border-emerald-500/40 hover:border-emerald-300 hover:text-white"
            : "border-danger/40 hover:border-danger hover:text-white"
        }`}
      >
        Dismiss
      </button>
    </div>
  );
}
