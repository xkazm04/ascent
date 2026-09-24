// The provider kinds an org can connect as BYOM, declared ONCE.
//
// A pure leaf (no db, no provider SDKs) so the client-safe lane projection (lane-routes.ts), the db
// layer (org-llm.ts) and the registry's kind -> provider mapping (registry.ts byomDescriptor) all read
// the same list. A kind is also its ProviderName: an active BYOM of kind `nebius` runs on the `nebius`
// provider, which is what lets the lane card name the engine without a second table.
//
//   bedrock     the org's AWS key pair; inference stays in its own account and region.
//   openrouter  one API key routing to third-party upstreams (a cost/flexibility path).
//   nebius      one Token Factory API key; hosted open-weight inference in Nebius's datacenter.

import type { ProviderName } from "@/lib/types";

export const BYOM_KINDS = ["bedrock", "openrouter", "nebius"] as const satisfies readonly ProviderName[];
export type ByomKind = (typeof BYOM_KINDS)[number];

/** The kinds whose whole credential is ONE API key (stored as `{ kind, apiKey }`). */
export const API_KEY_BYOM_KINDS = ["openrouter", "nebius"] as const satisfies readonly ByomKind[];
export type ApiKeyByomKind = (typeof API_KEY_BYOM_KINDS)[number];

export function isByomKind(value: string | null | undefined): value is ByomKind {
  return (BYOM_KINDS as readonly string[]).includes(value ?? "");
}

export function isApiKeyByomKind(value: string | null | undefined): value is ApiKeyByomKind {
  return (API_KEY_BYOM_KINDS as readonly string[]).includes(value ?? "");
}
