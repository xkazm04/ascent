// Nebius BYOM: connect the org's own Nebius Token Factory key so scans, Athena and the board narrative
// run hosted open-weight models (GLM, Nemotron, MiniMax) billed to the org's Nebius account instead of
// the platform provider. Like OpenRouter it is NOT in-boundary: the model runs in Nebius's datacenter.
// The form, flow and gates are the shared API-key card (ApiKeyByomSettings); this file owns Nebius's
// spec and caution.
//
// No default model, for the reason src/lib/llm/nebius.ts gives: an invented id 404s on an account
// that has not enabled it, so Save and Test stay disabled until the owner types an exact id.
//
// Server-safe: no hooks, no handlers. The client boundary is ApiKeyByomSettings.

import { ApiKeyByomSettings, type ApiKeyByomProps, type ApiKeyByomSpec } from "./ApiKeyByomSettings";

const SPEC: ApiKeyByomSpec = {
  kind: "nebius",
  title: "Bring your own model (Nebius)",
  description: "Custom plan · your Nebius Token Factory key",
  modelLabel: "Model id",
  defaultModel: "",
  modelPlaceholder: "zai-org/GLM-5.3-Flash",
  keyLabel: "Nebius API key",
  keyPlaceholder: "Token Factory API key",
};

export function NebiusByomSettings(props: ApiKeyByomProps) {
  const caution = (
    <p role="note" className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 type-body-sm text-orange-200">
      <span aria-hidden>⚠</span> Nebius runs the model in its own datacenter, and your request, repository file
      samples included, goes there. This is <strong className="font-semibold">not in-boundary</strong>{" "}
      the way Bedrock is. Use an exact model id from your Token Factory account.
    </p>
  );
  return <ApiKeyByomSettings spec={SPEC} caution={caution} {...props} />;
}
