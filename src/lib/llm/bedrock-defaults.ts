// The Bedrock default model + region, as a PURE module with no imports.
//
// Why these two constants live apart from the provider that uses them: the org settings card
// (src/features/admin/settings/useLlmProviderSettings.ts) needs the same defaults to pre-fill and
// placeholder its fields, and that file is `"use client"`. Importing them from `@/lib/llm/bedrock`
// would drag the provider's whole dependency tree — the assessment prompt builder, the LLM config,
// the schema — across the client/server boundary for two string literals. `tsc` and vitest both pass
// on that break; only `next build` catches it, which is exactly the trap this repo has hit before
// (AGENTS.md gate note). A pure sibling both sides may import is the established remedy.
//
// `bedrock.ts` re-exports both names, so every server-side importer is unchanged and there is still
// only ONE definition of each value.

/** Latest Claude Sonnet (4.6) via the US geo inference profile — data stays in-US while remaining
 *  available in us-east-1, where 4.6 has no in-Region endpoint. Override with BEDROCK_MODEL_ID. */
export const DEFAULT_BEDROCK_MODEL = "us.anthropic.claude-sonnet-4-6";

/** Default Bedrock region. Override with BEDROCK_REGION (or AWS_REGION). */
export const DEFAULT_BEDROCK_REGION = "us-east-1";
