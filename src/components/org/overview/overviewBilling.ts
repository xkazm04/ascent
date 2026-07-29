// Pure reading of the post-checkout return params (docs/ORG-TABS-REFACTOR.md §3: state and pure
// logic leave the .tsx first). /api/billing/checkout redirects the buyer back to the org dashboard
// with ?credits=pending (paid; webhook fulfilment in flight) or ?credits=error (session creation
// failed, not charged). The dismiss href drops ONLY that param and preserves everything else, so
// dismissing the notice never silently resets the period or the segment scope.

type SearchParams = { [key: string]: string | string[] | undefined };

export type BillingReturnStatus = "pending" | "error";

export interface BillingReturn {
  status: BillingReturnStatus;
  /** The current URL minus `?credits=` — where the notice's dismiss control points. */
  dismissHref: string;
}

export function resolveBillingReturn(slug: string, sp: SearchParams): BillingReturn | null {
  const raw = Array.isArray(sp.credits) ? sp.credits[0] : sp.credits;
  const status: BillingReturnStatus | null = raw === "pending" ? "pending" : raw === "error" ? "error" : null;
  if (!status) return null;

  const remaining = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "credits" || v === undefined) continue;
    for (const val of Array.isArray(v) ? v : [v]) remaining.append(k, val);
  }
  const qs = remaining.toString();
  return { status, dismissHref: `/org/${encodeURIComponent(slug)}${qs ? `?${qs}` : ""}` };
}
