// Polar (polar.sh) billing config — the one place that reads the POLAR_* env and turns it into a
// configured client + the credit-pack catalog. Everything is env-driven and degrades to a clean no-op
// when unconfigured: with no access token, polarEnabled() is false and the UI hides "Buy credits",
// mirroring how the rest of Ascent treats optional integrations. Sandbox by default. See docs/BILLING.md.
//
// The grant AMOUNT is derived here from the PRODUCT purchased (server-authoritative, the pack map),
// never from anything the client sends — so a crafted checkout can't pay for a small pack and then
// claim a large credit grant. The webhook and the "Buy credits" UI both read this single catalog.

import { Polar } from "@polar-sh/sdk";

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

/** True when a Polar checkout can run: a token is set AND at least one pack is configured to sell. */
export function polarEnabled(): boolean {
  return polarToken() !== null && creditPacks().length > 0;
}

/** A configured Polar client (sandbox/production), or null when no access token is set. */
export function getPolar(): Polar | null {
  const accessToken = polarToken();
  if (!accessToken) return null;
  return new Polar({ accessToken, server: polarServer() });
}
