"use client";

// Post-checkout return notice (checkout-plans-polar 2026-07-16 #1). /api/billing/checkout 303s the
// returning buyer to /org/<slug>?credits=pending&checkout_id=<Polar id> (payment submitted, fulfilment
// webhook-async) or ?credits=error (session creation failed, nothing charged).
//
// A pending return follows THIS purchase (useCheckoutReturn polls /api/billing/checkout/status) through
// confirming -> paid -> landed, or stalled / failed / expired, and paints what arrived. It used to say
// "Payment received" unconditionally and never change, on a bookmark as much as on a failed payment, so
// a stuck fulfilment read as "within a minute" forever and buyers bought again. A return with no
// checkout id renders the unverified copy and claims nothing.
//
// Dismiss strips the billing params via router.replace(dismissHref) - built server-side from the
// remaining search params - so a reload/share of the URL doesn't resurrect a stale notice.

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { checkoutReturnCopy, type CheckoutReturnTone } from "@/lib/billing/checkoutReturnModel";
import { useCheckoutReturn } from "./useCheckoutReturn";

const TONE: Record<CheckoutReturnTone | "error", { box: string; button: string }> = {
  progress: {
    box: "border-sky-500/40 bg-sky-500/10 text-sky-200",
    button: "border-sky-500/40 hover:border-sky-300 hover:text-white",
  },
  success: {
    box: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    button: "border-emerald-500/40 hover:border-emerald-300 hover:text-white",
  },
  warning: {
    box: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    button: "border-amber-500/40 hover:border-amber-300 hover:text-white",
  },
  danger: {
    box: "border-danger/40 bg-danger/10 text-danger-soft",
    button: "border-danger/40 hover:border-danger hover:text-white",
  },
  error: {
    box: "border-danger/40 bg-danger/10 text-danger-soft",
    button: "border-danger/40 hover:border-danger hover:text-white",
  },
};

function Shell({
  tone,
  alert,
  onDismiss,
  children,
}: {
  tone: keyof typeof TONE;
  alert: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  return (
    <div
      // Payment-outcome feedback must be announced: status (polite) while it is in hand or progressing,
      // alert when the buyer has to act (failed, expired, stalled, checkout not started).
      role={alert ? "alert" : "status"}
      className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 type-body-sm ${TONE[tone].box}`}
    >
      <p>{children}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss billing notice"
        className={`focus-ring shrink-0 rounded-md border px-2 py-0.5 type-note transition ${TONE[tone].button}`}
      >
        Dismiss
      </button>
    </div>
  );
}

function PendingReturn({ org, checkoutId, onDismiss }: { org: string; checkoutId: string | null; onDismiss: () => void }) {
  const view = useCheckoutReturn(org, checkoutId);
  const copy = checkoutReturnCopy(view);
  const alert = view.state === "stalled" || copy.tone === "danger";
  return (
    <Shell tone={copy.tone} alert={alert} onDismiss={onDismiss}>
      <strong>{copy.title}</strong> {copy.body}
    </Shell>
  );
}

export function BillingReturnNotice({
  status,
  org,
  checkoutId,
  dismissHref,
}: {
  /** `pending` = the buyer came back from a Polar checkout; what happened is asked, not assumed.
   *  `error` = the checkout session couldn't be created: the user was NOT charged. */
  status: "pending" | "error";
  /** The org the checkout was minted for. */
  org: string;
  /** Polar's checkout id from the success URL; null on a bookmarked/legacy link (renders unverified). */
  checkoutId: string | null;
  /** The current URL with the billing params stripped (other params preserved). */
  dismissHref: string;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true); // hide immediately; the replace then makes it durable
    router.replace(dismissHref, { scroll: false });
  };

  if (status === "pending") return <PendingReturn org={org} checkoutId={checkoutId} onDismiss={dismiss} />;
  return (
    <Shell tone="error" alert onDismiss={dismiss}>
      <strong>Checkout couldn&apos;t be started.</strong> You were <strong>not charged</strong>. Please try
      again from the credits menu or the pricing page.
    </Shell>
  );
}
