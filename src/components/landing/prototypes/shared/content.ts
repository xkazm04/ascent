// Shared marketing copy + pricing data for the landing page. The CONTENT (the honest pricing ladder,
// the method steps) is defined once here so the sections can't drift from each other or from the rubric.

import { DIMENSIONS } from "@/lib/maturity/model";

export interface PricingTier {
  name: string;
  price: string;
  tagline: string;
  featured: boolean;
  features: string[];
  note: string;
}

/**
 * Pricing cards. The Public card states the freemium ladder honestly: when the weekly gate is live, its
 * first feature carries the REAL limits and sells the free-account upgrade; only a deploy with no
 * enforceable gate (`quota: null`) may say "unlimited".
 */
export function buildPricing(quota: { anon: number; member: number } | null): PricingTier[] {
  return [
    {
      name: "Public",
      price: "Free",
      tagline: "Any public repo, on the web",
      featured: false,
      features: [
        quota
          ? `${quota.anon} free scans a week — ${quota.member} with a free account`
          : "Unlimited public-repo scans",
        "Full report · radar · roadmap",
        "Shareable maturity badge",
      ],
      note: quota
        ? "No signup needed to start. Free for public repositories — sign in to lift the weekly limit."
        : "No signup. Free forever for public repositories.",
    },
    ...PRICING_PAID,
  ];
}

const PRICING_PAID: PricingTier[] = [
  {
    name: "Private",
    price: "Prepaid credits",
    tagline: "One credit per private scan",
    featured: true,
    features: [
      "Private repos via token / GitHub App",
      "Scan history + progress trends",
      "Recommendation tracking",
      "PDF report export",
    ],
    note: "Buy a balance of scan credits; each private scan uses one. No subscription. Indicative; final rate TBD.",
  },
  {
    name: "Enterprise",
    price: "Custom",
    tagline: "Implemented on demand",
    featured: false,
    features: [
      "Private inference via AWS Bedrock",
      "SSO / SAML + RBAC",
      "Audit logs · data residency · VPC",
      "Org rollups + dedicated support",
    ],
    note: "Tailored deployment for your security and scale requirements.",
  },
];

export interface HowStep {
  n: string;
  t: string;
  d: string;
}

export const HOW_STEPS: HowStep[] = [
  {
    n: "01",
    t: "Read the repo",
    d: "We read structure, configs, CI, tests, docs, and recent commits via the GitHub API — no clone, nothing stored.",
  },
  {
    n: "02",
    t: "Score the signals",
    d: "Deterministic detectors extract evidence; an LLM adds nuance — guardbanded to the evidence so scores stay honest.",
  },
  {
    n: "03",
    t: "Get the route",
    d: `A level, a radar across ${DIMENSIONS.length} dimensions, the evidence behind every score, and prioritized next steps to climb.`,
  },
];
