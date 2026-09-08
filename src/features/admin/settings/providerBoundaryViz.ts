// The provider comparison, as a matrix — the /org redesign (docs/ORG-UX-REDESIGN.md §2) against the
// one thing this tab asks an owner to decide: whose computer runs the inference, and who pays for it.
//
// It used to be two paragraphs, one per card, that a reader had to hold in their head and diff:
//
//   Bedrock     — "inference stays in your AWS account and region, billed to your AWS account."
//   OpenRouter  — "billed to your OpenRouter account. Note: OpenRouter routes to third-party
//                  upstreams, so this is NOT in-boundary like Bedrock."
//
// The distinction those two paragraphs encode is a BOUNDARY, and a boundary is drawable. Three rows,
// four columns, and — the part prose cannot do — three DIFFERENT kinds of "no" in the Boundary
// column, each with its own mark:
//
//   Bedrock     solid   — the adapter calls YOUR account, in YOUR region, with YOUR credential.
//   OpenRouter  VOID    — it routes the request (repo file samples included) to a third-party
//                         upstream. There is no boundary to paint, which is the guarantee inverted:
//                         Wave 1's result was that an absence you can SEE beats one you are promised.
//   Ascent      hatched — NOT JUDGED. What the platform default runs on is the DEPLOYMENT's own
//                         `LLM_PROVIDER` (which on a self-hosted install may well be an Ollama on
//                         your own hardware). This org-scoped page does not observe it, so it must
//                         not claim either answer. Hatched is "missing evidence, not a finding" —
//                         and `rendersValue` is false for it, so the cell cannot print anything.
//
// Pure: no React, no hooks, no I/O. The kit types are `import type`.

import type { MatrixRow, VizState } from "@/components/org/viz";
import type { OrgLlmConfigPublic } from "@/lib/db";

/** Column names. Kept to ≤8 characters: MatrixGrid's cells are 46 user units wide and the axis label
 *  is centred mono-uppercase at 9px + 0.18em tracking, so a longer word collides with its neighbour. */
export const PROVIDER_AXES = ["Boundary", "Billing", "Plan", "Active"] as const;
export type ProviderAxis = (typeof PROVIDER_AXES)[number];

/** The row order is the decision order: what you get by default, then the two things you can connect. */
export const PROVIDER_ROWS = ["ascent", "bedrock", "openrouter"] as const;
export type ProviderRowId = (typeof PROVIDER_ROWS)[number];

/**
 * The (D) Disclosed destination for the demoted paragraphs. One sentence-set per COLUMN rather than
 * per card, because the fact each one carries is only meaningful as a comparison — which is precisely
 * why it read badly as two separate paragraphs.
 */
export const PROVIDER_AXIS_HINT: Record<ProviderAxis, string> = {
  Boundary:
    "Whether inference runs inside infrastructure you control. Bedrock is solid: the request goes to your own AWS account, in your own region, under your own credential. OpenRouter is EMPTY — it routes the request, repository file samples included, on to a third-party upstream, so it is NOT in-boundary. The Ascent default is hatched because this page cannot see which provider the deployment itself is configured to call.",
  Billing:
    "Whether token spend for scans lands on your own vendor account. Bedrock bills your AWS account and OpenRouter bills your OpenRouter account; the Ascent default draws this organization's plan credits instead, so no vendor account of yours is billed.",
  Plan: "Connecting your own model is a Custom-plan capability. An empty cell means this organization's current plan does not include it, and the card below is read-only until that changes.",
  Active:
    "An organization runs exactly ONE connected provider, so saving one replaces the other. A ringed cell is the provider a person chose and scans use now; a dashed cell is stored but not switched on; a hatched cell holds a credential that has never been test-connected, so nobody has judged whether it works; a struck cell was superseded when another provider took the slot.",
};

/** Row labels, drawn into MatrixGrid's 104-unit gutter at 10px — the same width budget as the axes. */
const ROW_LABEL: Record<ProviderRowId, string> = {
  ascent: "Ascent",
  bedrock: "Bedrock",
  openrouter: "OpenRouter",
};

/**
 * What the org's single provider slot says about ONE provider.
 *
 * The ladder is ordered by what a reader most needs to know: a provider that is switched on is
 * `decided` (a person put it there) even if it was never validated, because it is what runs; a stored
 * credential that has never been tested is `not-judged` rather than `declared`, since "we have not
 * checked" is a different claim from "declared, not enforced".
 */
export function slotState(config: OrgLlmConfigPublic | null, provider: ProviderRowId): VizState {
  if (provider === "ascent") {
    // The platform default IS what scans run on until a BYOM is switched on; then it is superseded.
    return config?.enabled ? "superseded" : "measured";
  }
  if (!config || config.provider !== provider) return "missing";
  if (config.enabled) return "decided";
  if (!config.hasCredentials) return "missing";
  return config.lastValidatedAt ? "declared" : "not-judged";
}

/** The three rows, in decision order. `planAllowed` is org-specific; the other columns are the
 *  providers' own properties, which is why they do not move when the plan does. */
export function providerBoundaryRows({
  config,
  planAllowed,
}: {
  config: OrgLlmConfigPublic | null;
  planAllowed: boolean;
}): MatrixRow[] {
  const plan: VizState = planAllowed ? "measured" : "missing";
  const byId: Record<ProviderRowId, VizState[]> = {
    // Boundary hatched: not judged from here. Billing void: your plan credits, not a vendor account.
    ascent: ["not-judged", "missing", "measured", slotState(config, "ascent")],
    bedrock: ["measured", "measured", plan, slotState(config, "bedrock")],
    // The void that is the whole panel: OpenRouter has no boundary to paint.
    openrouter: ["missing", "measured", plan, slotState(config, "openrouter")],
  };
  return PROVIDER_ROWS.map((id) => ({
    id,
    label: ROW_LABEL[id],
    cells: byId[id].map((state) => ({ state })),
  }));
}

/** Only the states this matrix actually draws, in kit order — the `Legend` contract (never a static
 *  six-row key for a picture that uses three). */
export function providerBoundaryStates(rows: MatrixRow[]): VizState[] {
  const order: VizState[] = ["measured", "declared", "not-judged", "missing", "decided", "superseded"];
  const present = new Set(rows.flatMap((r) => r.cells.map((c) => c.state)));
  return order.filter((s) => present.has(s));
}

/** "Custom plan · one connected provider" — scope, not meaning (§2.3). */
export function providerScopeLine(config: OrgLlmConfigPublic | null): string {
  return config?.enabled ? `${config.provider} · connected` : "no provider connected";
}
