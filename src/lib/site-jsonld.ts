// Site-wide JSON-LD graph (Organization + SoftwareApplication) inlined by the root layout.
// Paid Offer prices are the numeric planPriceLabel() amounts so they cannot drift from /pricing
// (G8: numeric, anonymous, one click). The free tier's $0 and the Custom tier's "Flexible" are
// omitted: a SoftwareApplication Offer at zero is a site-wide claim that the product is free,
// which /pricing contradicts.

import { PLAN_FEATURES, PLAN_ORDER, planPriceLabel } from "@/lib/plans";
import { publicBaseUrl, siteDescription } from "@/lib/site";

/** Turn a planPriceLabel amount into a schema.org Offer price, or null when it is not a paid number. */
export function jsonLdOfferPrice(amount: string): string | null {
  const m = /^\$(\d+(?:\.\d+)?)$/.exec(amount);
  const raw = m?.[1];
  if (raw === undefined) return null;
  if (Number(raw) === 0) return null;
  return raw;
}

type JsonLdOffer = {
  "@type": "Offer";
  name: string;
  price: string;
  priceCurrency: "USD";
};

export type JsonLdAggregateOffer = {
  "@type": "AggregateOffer";
  priceCurrency: "USD";
  lowPrice: string;
  highPrice: string;
  offerCount: number;
  offers: JsonLdOffer[];
  url?: string;
};

/** Paid, numeric Offers derived from planPriceLabel. Undefined when no paid number exists. */
export function siteJsonLdOffers(baseUrl: string = publicBaseUrl()): JsonLdAggregateOffer | undefined {
  const offers: JsonLdOffer[] = [];
  for (const id of PLAN_ORDER) {
    const price = jsonLdOfferPrice(planPriceLabel(id).amount);
    if (price == null) continue;
    offers.push({
      "@type": "Offer",
      name: PLAN_FEATURES[id].label,
      price,
      priceCurrency: "USD",
    });
  }
  if (offers.length === 0) return undefined;
  const nums = offers.map((o) => Number(o.price));
  return {
    "@type": "AggregateOffer",
    priceCurrency: "USD",
    lowPrice: String(Math.min(...nums)),
    highPrice: String(Math.max(...nums)),
    offerCount: offers.length,
    offers,
    ...(baseUrl ? { url: `${baseUrl}/pricing` } : {}),
  };
}

export function siteStructuredData(baseUrl: string = publicBaseUrl()) {
  const offers = siteJsonLdOffers(baseUrl);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "Ascent",
        description: "The maturity index for AI-native engineering.",
        ...(baseUrl ? { url: baseUrl, logo: `${baseUrl}/brand/logo-mark.png` } : {}),
      },
      {
        "@type": "SoftwareApplication",
        name: "Ascent",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Web",
        description: siteDescription(),
        ...(baseUrl ? { url: baseUrl } : {}),
        ...(offers ? { offers } : {}),
      },
    ],
  };
}
