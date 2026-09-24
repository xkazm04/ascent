// OpenRouter BYOM: connect the org's own OpenRouter key so scans run on any model behind one key. Unlike
// the Bedrock card, this is a COST/FLEXIBILITY path, NOT the in-boundary privacy guarantee: OpenRouter
// routes the request (repo file samples included) to the selected model's third-party upstream. The
// form, its flow and its gates are the shared API-key card (ApiKeyByomSettings); this file owns what
// is OpenRouter's own: the spec and the caution. See ModelScorecard for which model to pick.
//
// Server-safe: no hooks, no handlers. The client boundary is ApiKeyByomSettings.

import { ApiKeyByomSettings, type ApiKeyByomProps, type ApiKeyByomSpec } from "./ApiKeyByomSettings";

const SPEC: ApiKeyByomSpec = {
  kind: "openrouter",
  title: "Bring your own model (OpenRouter)",
  description: "Custom plan · your OpenRouter key",
  modelLabel: "Model slug",
  defaultModel: "openai/gpt-4o-mini",
  modelPlaceholder: "openai/gpt-4o-mini",
  keyLabel: "OpenRouter API key",
  keyPlaceholder: "sk-or-…",
};

export function OpenRouterByomSettings(props: ApiKeyByomProps) {
  // The boundary warning, KEPT and made LOUDER rather than demoted. ProviderBoundaryCard now draws it
  // (OpenRouter's Boundary cell is a void beside Bedrock's solid one), but §2.1 of
  // docs/ORG-UX-REDESIGN.md lets a sentence stay when demoting it would weaken it, and this is the one
  // sentence on the tab that changes whether an owner should paste a key at all. It sits on the form
  // itself, above the key field, where the decision is actually made.
  const caution = (
    <p role="note" className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 type-body-sm text-orange-200">
      <span aria-hidden>⚠</span> OpenRouter routes your request, repository file samples included, to the
      selected model&apos;s third-party upstream. This is <strong className="font-semibold">not in-boundary</strong>{" "}
      the way Bedrock is, where inference stays in your own AWS account and region.
    </p>
  );
  return <ApiKeyByomSettings spec={SPEC} caution={caution} {...props} />;
}
