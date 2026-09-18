// Polar (polar.sh) billing config — the one place that reads the POLAR_* env and turns it into a
// configured client + the credit-pack catalog + the owner customer-portal URL. Everything is env-driven
// and degrades to a clean no-op when unconfigured: with no access token, polarEnabled() is false and
// the UI hides "Buy credits" / "Manage billing", mirroring how the rest of Ascent treats optional
// integrations. Sandbox by default. See docs/features/billing/billing.md.
//
// The grant AMOUNT is derived here from the PRODUCT purchased (server-authoritative, the pack map),
// never from anything the client sends — so a crafted checkout can't pay for a small pack and then
// claim a large credit grant. The webhook and the "Buy credits" UI both read this single catalog.

import { Polar } from "@polar-sh/sdk";
import { isPlanId, type PlanId } from "@/lib/plans";

export type PolarServer = "sandbox" | "production";

/** A purchasable credit pack: a Polar product id mapped to the number of scan credits it grants. */
export interface CreditPack {
  productId: string;
  credits: number;
  label: string;
}

/** Target Polar environment — sandbox (default) unless POLAR_SERVER=production. */
export function polarServer(): PolarServer {
  return process.env.POLAR_SERVER === "production" ? "production" : "sandbox";
}

/** Server access token, or null when billing isn't configured on this deployment. */
function polarToken(): string | null {
  const t = process.env.POLAR_ACCESS_TOKEN?.trim();
  return t ? t : null;
}

/**
 * The credit-pack catalog, parsed from POLAR_CREDIT_PACKS — a comma-separated list of
 * `<productId>=<credits>` pairs (e.g. "prod_abc=100,prod_def=500,prod_ghi=2000"). Order is preserved
 * (cheapest-first by convention); malformed or non-positive entries are skipped. This is the SINGLE
 * source of truth for both what the "Buy credits" UI offers and how many credits the webhook grants.
 */
export function creditPacks(): CreditPack[] {
  const raw = process.env.POLAR_CREDIT_PACKS?.trim();
  if (!raw) return [];
  const packs: CreditPack[] = [];
  for (const part of raw.split(",")) {
    const [id, creditsStr] = part.split("=").map((s) => s.trim());
    const credits = Number(creditsStr);
    if (!id || !Number.isInteger(credits) || credits <= 0) continue;
    packs.push({ productId: id, credits, label: `${credits.toLocaleString("en-US")} credits` });
  }
  return packs;
}

/** Credits granted by a purchased product id (server-authoritative), or 0 when it's not a known pack. */
export function creditsForProduct(productId: string | null | undefined): number {
  if (!productId) return 0;
  return creditPacks().find((p) => p.productId === productId)?.credits ?? 0;
}

/** A purchasable plan-tier upgrade: a Polar product id mapped to the plan tier it grants. */
export interface PlanProduct {
  productId: string;
  plan: PlanId;
}

/**
 * The plan-tier product catalog, parsed from POLAR_PLAN_PRODUCTS — a comma-separated list of
 * `<productId>=<planId>` pairs (e.g. "prod_pro=pro,prod_team=team,prod_ent=enterprise"). This is the
 * server-authoritative binding from a paid Polar product to the entitlement tier the buyer receives;
 * entries whose plan isn't a known PlanId (see lib/plans) are skipped. Unset → no product upgrades a
 * tier (billing stays credit-only, the prior behaviour). Mirrors the POLAR_CREDIT_PACKS convention.
 */
export function planProducts(): PlanProduct[] {
  const raw = process.env.POLAR_PLAN_PRODUCTS?.trim();
  if (!raw) return [];
  const products: PlanProduct[] = [];
  for (const part of raw.split(",")) {
    const [id, plan] = part.split("=").map((s) => s.trim());
    if (!id || !plan || !isPlanId(plan)) continue;
    products.push({ productId: id, plan });
  }
  return products;
}

/** The plan tier a purchased product id grants (server-authoritative), or null when it's not a known
 *  plan product. A single product can be BOTH a plan product and a credit pack (an upgrade that also
 *  seeds credits); the webhook applies whichever mappings match. */
export function planForProduct(productId: string | null | undefined): PlanId | null {
  if (!productId) return null;
  return planProducts().find((p) => p.productId === productId)?.plan ?? null;
}

/** True when a Polar checkout can run: a token is set AND at least one SELLABLE product is configured —
 *  a credit pack (POLAR_CREDIT_PACKS) OR a plan-tier subscription (POLAR_PLAN_PRODUCTS). Gating on credit
 *  packs ALONE wrongly disabled checkout (503) and hid the buy UI on a subscription-ONLY deployment that
 *  sells plan tiers but no à-la-carte credits — a real, supported config. Either catalog being non-empty
 *  is enough; the "Buy credits" pack list stays keyed off creditPacks(), so a plan-only deployment still
 *  shows no empty pack picker. */
export function polarEnabled(): boolean {
  return polarToken() !== null && (creditPacks().length > 0 || planProducts().length > 0);
}

/** A configured Polar client (sandbox/production), or null when no access token is set. */
export function getPolar(): Polar | null {
  const accessToken = polarToken();
  if (!accessToken) return null;
  return new Polar({ accessToken, server: polarServer() });
}

/** Polar's documented hosted customer portal (`https://polar.sh/<org-slug>/portal`). Sandbox uses
 *  `sandbox.polar.sh`. Empty slug → null. This is the unauthenticated login page (email + one-time
 *  code), not a per-customer session. */
export function polarHostedPortalUrl(polarOrganizationSlug: string): string | null {
  const slug = polarOrganizationSlug.trim();
  if (!slug) return null;
  const host = polarServer() === "production" ? "https://polar.sh" : "https://sandbox.polar.sh";
  return `${host}/${encodeURIComponent(slug)}/portal`;
}

type PolarPortalSession = { customerPortalUrl?: string | null };

/** `customerSessions.create` when this Polar SDK build exposes it; otherwise null (fall back to the
 *  hosted URL builder). Checkout stamps `externalCustomerId` as the Ascent org slug, so the session
 *  is keyed the same way. */
function polarCustomerSessionsCreate(
  polar: Polar,
): ((body: { externalCustomerId: string; returnUrl?: string }) => Promise<PolarPortalSession>) | null {
  const sessions = (
    polar as Polar & {
      customerSessions?: {
        create?: (body: { externalCustomerId: string; returnUrl?: string }) => Promise<PolarPortalSession>;
      };
    }
  ).customerSessions;
  const create = sessions?.create;
  if (typeof create !== "function") return null;
  return (body) => create.call(sessions, body);
}

/**
 * One-click Polar customer-portal URL for an Ascent org (the same `externalCustomerId` checkout
 * stamps). Polar-unconfigured / self-host → null so the UI omits "Manage billing". Prefers a live
 * `customerSessions.create` when the SDK has it; otherwise Polar's documented hosted portal page
 * (`POLAR_ORGANIZATION_SLUG`). A session miss (org never checked out) also falls through to that
 * page when the slug is set.
 */
export async function polarCustomerPortalUrl(
  externalCustomerId: string,
  opts?: { returnUrl?: string },
): Promise<string | null> {
  const id = externalCustomerId.trim();
  if (!id || !polarEnabled()) return null;
  const polar = getPolar();
  if (!polar) return null;
  const create = polarCustomerSessionsCreate(polar);
  if (create) {
    try {
      const session = await create({
        externalCustomerId: id,
        ...(opts?.returnUrl ? { returnUrl: opts.returnUrl } : {}),
      });
      const url = session.customerPortalUrl?.trim();
      if (url) return url;
    } catch {
      // Unknown Polar customer, or the OAT lacks customer_sessions:write — try the hosted page.
    }
  }
  const slug = process.env.POLAR_ORGANIZATION_SLUG?.trim();
  return slug ? polarHostedPortalUrl(slug) : null;
}
