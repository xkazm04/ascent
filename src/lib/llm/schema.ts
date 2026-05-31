// Single source of truth for the LLM assessment output contract, expressed as a
// JSON Schema so providers can constrain decoding at the source instead of hoping
// the prose prompt is obeyed:
//   - Gemini  -> config.responseJsonSchema   (native structured output)
//   - Bedrock -> Converse tool + forced toolChoice (function-calling JSON)
//
// This mirrors the LlmAssessment TypeScript type and the runtime safety net
// validateAssessment() in src/lib/llm/provider.ts — the same contract enforced at
// two layers: constrain the model up front, then defensively coerce whatever comes
// back (a model may still ignore the schema, or a provider may not support it).
// The dimension-id enum is derived from the maturity model (DIMENSIONS), so the
// schema can never drift from the rubric the rest of the app scores against.

import { DIMENSIONS } from "@/lib/maturity/model";

const DIMENSION_IDS = DIMENSIONS.map((d) => d.id);
const LEVELS = ["high", "medium", "low"];
const stringArray = { type: "array", items: { type: "string" } };

/**
 * JSON Schema (draft-07 compatible) describing a well-formed LlmAssessment
 * (see src/lib/types.ts). Restricted to widely-supported keywords (type /
 * properties / required / items / enum / minimum / maximum) so the SAME object is
 * accepted by both Gemini's responseJsonSchema and Bedrock's Converse tool
 * inputSchema.
 */
export const ASSESSMENT_JSON_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One-sentence overall verdict." },
    dimensions: {
      type: "array",
      description: `One entry per scoring dimension (all ${DIMENSION_IDS.length}).`,
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: DIMENSION_IDS },
          score: { type: "integer", minimum: 0, maximum: 100 },
          summary: { type: "string" },
          strengths: stringArray,
          gaps: stringArray,
        },
        required: ["id", "score", "summary", "strengths", "gaps"],
      },
    },
    strengths: { ...stringArray, description: "Top cross-cutting strengths." },
    risks: { ...stringArray, description: "Top cross-cutting risks." },
    roadmap: {
      type: "array",
      description: "Prioritized, high-leverage next steps.",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          dimension: { type: "string", enum: DIMENSION_IDS },
          impact: { type: "string", enum: LEVELS },
          effort: { type: "string", enum: LEVELS },
          rationale: { type: "string" },
          explore: { ...stringArray, description: "2-3 invitational questions." },
          levelUnlock: { type: "string" },
        },
        required: ["title", "dimension", "impact", "effort", "rationale"],
      },
    },
    discrepancies: {
      type: "array",
      description: "Dimensions where the deterministic signals look wrong.",
      items: {
        type: "object",
        properties: {
          dimension: { type: "string", enum: DIMENSION_IDS },
          claim: { type: "string" },
        },
        required: ["dimension", "claim"],
      },
    },
  },
  required: ["headline", "dimensions", "strengths", "risks", "roadmap", "discrepancies"],
};

/** Bedrock Converse tool used to force a schema-constrained JSON response. */
export const ASSESSMENT_TOOL_NAME = "report_assessment";
export const ASSESSMENT_TOOL_DESCRIPTION =
  "Return the engineering-maturity assessment as structured JSON. Call this tool " +
  `exactly once with the complete assessment for all ${DIMENSION_IDS.length} dimensions.`;
