// Pure reading of the post-checkout return params (docs/ORG-TABS-REFACTOR.md §3: state and pure
// logic leave the .tsx first). /api/billing/checkout redirects the buyer back to the org dashboard
// with ?credits=pending (paid; webhook fulfilment in flight) or ?credits=error (session creation
// failed, not charged). The dismiss href drops ONLY that param and preserves everything else, so
// dismissing the notice never silently resets the period or the segment scope.
// A pending return also carries Polar's `checkout_id` (substituted into the success URL), which the
// notice uses to follow THIS purchase; it is stripped from the dismiss href with `credits`.

type SearchParams = { [key: string]: string | string[] | undefined };

export type BillingReturnStatus = "pending" | "error";

export interface BillingReturn {
  status: BillingReturnStatus;
  /** The Polar checkout this return is for; null on an error return or a bookmarked/legacy link. */
  checkoutId: string | null;
  /** The current URL minus `?credits=` and `?checkout_id=`: where the notice's dismiss control points. */
  dismissHref: string;
}

const BILLING_PARAMS = new Set(["credits", "checkout_id"]);

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function resolveBillingReturn(slug: string, sp: SearchParams): BillingReturn | null {
  const raw = first(sp.credits);
  const status: BillingReturnStatus | null = raw === "pending" ? "pending" : raw === "error" ? "error" : null;
  if (!status) return null;
  const checkoutId = status === "pending" ? first(sp.checkout_id)?.trim() || null : null;

  const remaining = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (BILLING_PARAMS.has(k) || v === undefined) continue;
    for (const val of Array.isArray(v) ? v : [v]) remaining.append(k, val);
  }
  const qs = remaining.toString();
  return { status, checkoutId, dismissHref: `/org/${encodeURIComponent(slug)}${qs ? `?${qs}` : ""}` };
}
