// Pure model of "what happened to THIS purchase" for the post-checkout return banner. The checkout
// route stamps Polar's {CHECKOUT_ID} into the success URL; GET /api/billing/checkout/status reads the
// checkout (bound to the org it was minted for), its order, and the local grant record (the CreditLedger
// row `polar:<orderId>` / the org plan + Subscription row), and folds those facts through
// deriveCheckoutReturn into ONE state. The banner renders checkoutReturnCopy(state) and polls until a
// terminal state.
//
// The one law: "landed" is only ever claimed from a grant record that exists. A paid checkout whose
// grant has not appeared is "paid" (the webhook is in flight, or Polar is retrying a fulfilment that
// threw), and after STALL_AFTER_MS it is "stalled" with the order id to quote. A return with no
// checkout id (bookmark, shared link) is "unverified" and never claims a payment. No imports: this
// module crosses to the client.

export type CheckoutReturnState = "unverified" | "confirming" | "paid" | "landed" | "stalled" | "failed" | "expired";

/** Paid but not landed for this long reads as stalled: the webhook normally lands in seconds. */
export const STALL_AFTER_MS = 10 * 60_000;

/** What landed, read from the grant record. `credits` is the ledger row's delta; `balance` the org's
 *  current balance; `plan` the tier the org now holds because of this order. */
export interface LandedGrant {
  credits?: number;
  balance?: number;
  plan?: string;
}

export interface CheckoutReturnFacts {
  /** Polar CheckoutStatus (open | expired | confirmed | succeeded | failed); null = no checkout to ask about. */
  checkoutStatus: string | null;
  /** The grant record, or false when it does not exist (yet). Only read for a succeeded checkout. */
  landed?: false | LandedGrant;
  /** Time since the payment went through; drives paid -> stalled. */
  elapsedMs?: number;
  orderId?: string | null;
}

/** The wire shape the status route returns and the banner consumes (no dates: it crosses to a client). */
export interface CheckoutReturnView {
  state: CheckoutReturnState;
  orderId?: string;
  credits?: number;
  balance?: number;
  plan?: string;
}

export function deriveCheckoutReturn(f: CheckoutReturnFacts): CheckoutReturnView {
  const orderId = f.orderId ?? undefined;
  switch (f.checkoutStatus) {
    case "expired":
      return { state: "expired" };
    case "failed":
      return { state: "failed" };
    case "open":
    case "confirmed":
      // Payment submitted (or the redirect beat Polar's own status write): processing, not received.
      return { state: "confirming" };
    case "succeeded": {
      if (f.landed) {
        const view: CheckoutReturnView = { state: "landed" };
        if (orderId) view.orderId = orderId;
        if (typeof f.landed.credits === "number") view.credits = f.landed.credits;
        if (typeof f.landed.balance === "number") view.balance = f.landed.balance;
        if (f.landed.plan) view.plan = f.landed.plan;
        return view;
      }
      const state = (f.elapsedMs ?? 0) >= STALL_AFTER_MS ? "stalled" : "paid";
      return orderId ? { state, orderId } : { state };
    }
    default:
      return { state: "unverified" };
  }
}

/** A state the banner stops polling at. "stalled" keeps polling (at the cap): Polar is still retrying
 *  delivery and the grant can still land. */
export function isTerminalCheckoutReturn(state: CheckoutReturnState): boolean {
  return state === "landed" || state === "failed" || state === "expired" || state === "unverified";
}

/** Poll delay after the n-th check (0-based): 2s, 4s, 8s, then capped at 15s. */
export function pollDelayMs(attempt: number): number {
  return Math.min(2000 * 2 ** Math.max(0, attempt), 15_000);
}

export type CheckoutReturnTone = "progress" | "success" | "warning" | "danger";

export interface CheckoutReturnCopy {
  tone: CheckoutReturnTone;
  title: string;
  body: string;
}

/** "+500 credits, balance 620" / "Plan: team" - the receipt line a landed grant renders. */
export function landedSummary(v: CheckoutReturnView): string {
  const parts: string[] = [];
  if (typeof v.credits === "number") parts.push(`+${v.credits} credits`);
  if (typeof v.balance === "number") parts.push(`balance ${v.balance}`);
  if (v.plan) parts.push(`plan ${v.plan}`);
  return parts.join(", ");
}

export function checkoutReturnCopy(v: CheckoutReturnView): CheckoutReturnCopy {
  switch (v.state) {
    case "confirming":
      return {
        tone: "progress",
        title: "Confirming your payment.",
        body: "Polar is still processing it. This notice updates on its own; there is no need to buy again.",
      };
    case "paid":
      return {
        tone: "progress",
        title: "Payment confirmed.",
        body: "Delivering your credits or plan now. This notice updates when they arrive.",
      };
    case "landed": {
      const summary = landedSummary(v);
      return { tone: "success", title: "Purchase delivered.", body: summary ? `${summary}.` : "Your purchase is active." };
    }
    case "stalled":
      return {
        tone: "warning",
        title: "Paid, but not delivered yet.",
        body: `Polar is retrying the delivery. Please do not buy again. If it has not arrived within the hour, contact support and quote order ${v.orderId ?? "(id unavailable)"}.`,
      };
    case "failed":
      return { tone: "danger", title: "The payment failed.", body: "Nothing was delivered. You can try again from the credits menu or the pricing page." };
    case "expired":
      return { tone: "danger", title: "The checkout expired before payment.", body: "Nothing was delivered. Start a new checkout to buy." };
    default:
      return {
        tone: "warning",
        title: "We could not confirm this payment yet.",
        body: "If you completed a purchase, your credits or plan appear on this page once Polar confirms it. Check your balance before buying again.",
      };
  }
}
