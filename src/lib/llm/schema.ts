// Single source of truth for the LLM assessment output contract, expressed as a
// JSON Schema so providers can constrain decoding at the source instead of hoping
// the prose prompt is obeyed:
//   - Gemini     -> config.responseJsonSchema   (native structured output)
//   - Bedrock    -> Converse tool + forced toolChoice (function-calling JSON)
//   - OpenAI     -> response_format json_schema, strict (see STRICT_ASSESSMENT_JSON_SCHEMA below)
//   - OpenRouter -> the same, proxied (falls back to json_object when an upstream refuses it)
//
// This mirrors the LlmAssessment TypeScript type and the runtime safety net
// validateAssessment() in src/lib/llm/provider.ts — the same contract enforced at
// two layers: constrain the model up front, then defensively coerce whatever comes
// back (a model may still ignore the schema, or a provider may not support it).
// The dimension-id enum is derived from the maturity model (DIMENSIONS), so the
// schema can never drift from the rubric the rest of the app scores against.

import { DIMENSIONS } from "@/lib/maturity/model";

const DIMENSION_IDS = DIMENSIONS.map((d) => d.id);
/** The impact/effort vocabulary — the single source for both the schema enum (constrain the model
 * up front) and provider.ts's runtime accept-list (defensively coerce after). Kept a mutable
 * `string[]` so the JSON Schema `enum` type matches what the Bedrock Converse tool spec expects. */
export const IMPACT_LEVELS: string[] = ["high", "medium", "low"];
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
          impact: { type: "string", enum: IMPACT_LEVELS },
          effort: { type: "string", enum: IMPACT_LEVELS },
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

// ---------------------------------------------------------------------------
// OpenAI-compatible strict structured output (openai.ts / openrouter.ts)
// ---------------------------------------------------------------------------

/** Loose JSON-Schema node shape — enough to walk/transform ASSESSMENT_JSON_SCHEMA generically. */
type SchemaNode = {
  type?: string | string[];
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  description?: string;
  additionalProperties?: boolean;
};

/** Widen a node's type to also admit null (OpenAI strict mode's ONLY way to express "optional"). */
function nullable(node: SchemaNode): SchemaNode {
  const t = node.type;
  if (t == null) return node;
  const types = Array.isArray(t) ? t : [t];
  return types.includes("null") ? node : { ...node, type: [...types, "null"] };
}

/**
 * Rewrite a JSON-Schema node into the dialect OpenAI's `strict: true` structured output accepts:
 *   - every object gets `additionalProperties: false` (hard requirement)
 *   - every object's `required` lists ALL its properties (strict mode forbids optional keys); a
 *     property that was OPTIONAL in the source schema is made nullable instead, which is OpenAI's
 *     documented emulation of optionality (validateAssessment already treats a null as "absent")
 *   - the numeric range keywords (`minimum`/`maximum`) are dropped — they are not in the supported
 *     strict-mode keyword set, and validateAssessment clamps the score anyway
 * Pure and derived — never a hand-copied second schema, so a rubric change flows through untouched.
 */
function strictifyNode(node: SchemaNode): SchemaNode {
  if (node.type === "object") {
    const props = node.properties ?? {};
    const wasRequired = new Set(node.required ?? Object.keys(props));
    const properties: Record<string, SchemaNode> = {};
    for (const [key, child] of Object.entries(props)) {
      const strictChild = strictifyNode(child);
      properties[key] = wasRequired.has(key) ? strictChild : nullable(strictChild);
    }
    return { ...node, properties, required: Object.keys(props), additionalProperties: false };
  }
  if (node.type === "array") {
    return node.items ? { ...node, items: strictifyNode(node.items) } : node;
  }
  const rest = { ...node };
  delete rest.minimum;
  delete rest.maximum;
  return rest;
}

/** Schema name sent with the strict structured-output request (OpenAI requires a stable identifier). */
export const ASSESSMENT_SCHEMA_NAME = "repo_maturity_assessment";

/**
 * The assessment contract as a STRICT OpenAI-compatible json_schema — derived from
 * ASSESSMENT_JSON_SCHEMA (the same object gemini/bedrock constrain against), never duplicated.
 * Computed once at module load; the result is frozen-by-convention (treat as read-only).
 */
export const STRICT_ASSESSMENT_JSON_SCHEMA = strictifyNode(ASSESSMENT_JSON_SCHEMA as SchemaNode);

/**
 * `response_format` for a schema-constrained decode on an OpenAI-compatible endpoint (OpenAI itself,
 * Azure, vLLM/Ollama/LM Studio, and OpenRouter — which proxies OpenAI's contract). This constrains the
 * SHAPE, not merely "is JSON": the baked model matrix shows json_object-only decoding is where
 * glm/deepseek/sonnet lose reliability (docs/LLM_MODEL_MATRIX.md).
 */
export function assessmentResponseFormat() {
  return {
    type: "json_schema" as const,
    json_schema: {
      name: ASSESSMENT_SCHEMA_NAME,
      strict: true,
      schema: STRICT_ASSESSMENT_JSON_SCHEMA,
    },
  };
}

/** The portable fallback: valid JSON, unconstrained shape. Used when a target rejects json_schema. */
export const JSON_OBJECT_RESPONSE_FORMAT = { type: "json_object" as const };

/**
 * Does this failed response look like "I don't support that response_format"? Not every
 * OpenAI-compatible target (older Azure api-versions, self-hosted vLLM/Ollama builds, and many
 * OpenRouter upstreams) implements strict json_schema; those reject the REQUEST with a 4xx naming the
 * field. Detecting that lets the adapter retry once on the json_object path instead of introducing a
 * new hard-failure mode for models that worked before. A genuine auth/quota/model error does NOT match,
 * so it still surfaces as a real failure.
 */
export function isResponseFormatRejection(status: number, body: string): boolean {
  if (status !== 400 && status !== 404 && status !== 422 && status !== 501) return false;
  return /response_format|json_schema|structured output|structured_output/i.test(body);
}
