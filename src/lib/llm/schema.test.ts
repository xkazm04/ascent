// First tests for the assessment output contract. Two things here are load-bearing and were unpinned:
//
//  1. STRICT_ASSESSMENT_JSON_SCHEMA is DERIVED from ASSESSMENT_JSON_SCHEMA by strictifyNode(), and it is
//     what openai.ts / openrouter.ts constrain decoding against. OpenAI's strict mode rejects the whole
//     REQUEST if the schema breaks its dialect rules, and the adapters read that rejection as "this
//     endpoint doesn't support strict" and silently retry on unconstrained json_object — so a bug in
//     the transform degrades every model to the weaker decode path instead of failing loudly.
//  2. isResponseFormatRejection decides whether a 4xx is "you don't support strict" (retry) or a real
//     error (surface it). Widen it and auth/quota failures get swallowed into a retry; narrow it and
//     endpoints that worked before start hard-failing.

import { describe, it, expect } from "vitest";
import { DIMENSIONS } from "@/lib/maturity/model";
import {
  ASSESSMENT_JSON_SCHEMA,
  ASSESSMENT_SCHEMA_NAME,
  ASSESSMENT_TOOL_DESCRIPTION,
  assessmentResponseFormat,
  IMPACT_LEVELS,
  isResponseFormatRejection,
  JSON_OBJECT_RESPONSE_FORMAT,
  STRICT_ASSESSMENT_JSON_SCHEMA,
} from "./schema";

type Node = {
  type?: string | string[];
  properties?: Record<string, Node>;
  required?: string[];
  items?: Node;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean;
};

/** Every object node in the tree, so the invariants below are asserted structurally, not spot-checked. */
function objectNodes(node: Node, path = "$", out: [string, Node][] = []): [string, Node][] {
  if (node.type === "object") out.push([path, node]);
  for (const [key, child] of Object.entries(node.properties ?? {})) objectNodes(child, `${path}.${key}`, out);
  if (node.items) objectNodes(node.items, `${path}[]`, out);
  return out;
}

const strict = STRICT_ASSESSMENT_JSON_SCHEMA as Node;

describe("STRICT_ASSESSMENT_JSON_SCHEMA — OpenAI strict-mode dialect", () => {
  it("covers more than one object node (the walk is actually reaching nested items)", () => {
    // Guards the guard: if objectNodes stopped descending, every invariant below would pass vacuously.
    expect(objectNodes(strict).length).toBeGreaterThanOrEqual(4);
  });

  it("sets additionalProperties:false on EVERY object — a hard strict-mode requirement", () => {
    for (const [path, node] of objectNodes(strict)) {
      expect(node.additionalProperties, `${path} must forbid extra properties`).toBe(false);
    }
  });

  it("lists EVERY property in `required` on every object — strict mode forbids optional keys", () => {
    for (const [path, node] of objectNodes(strict)) {
      expect(new Set(node.required ?? []), `${path} required must list all properties`).toEqual(
        new Set(Object.keys(node.properties ?? {})),
      );
    }
  });

  it("emulates optionality by making source-optional properties NULLABLE instead", () => {
    // roadmap items: `explore` and `levelUnlock` are absent from the source `required`, so strict mode's
    // only legal expression of "may be omitted" is a union with null (validateAssessment reads null as
    // absent). The genuinely-required siblings must NOT have been widened.
    const item = (strict.properties!.roadmap!.items ?? {}) as Node;
    const typeOf = (k: string) => {
      const t = item.properties![k]!.type;
      return Array.isArray(t) ? t : [t];
    };
    expect(typeOf("explore")).toContain("null");
    expect(typeOf("levelUnlock")).toContain("null");
    expect(typeOf("title")).not.toContain("null");
    expect(typeOf("dimension")).not.toContain("null");
  });

  it("drops minimum/maximum, which are not in the supported strict keyword set", () => {
    const score = (strict.properties!.dimensions!.items as Node).properties!.score!;
    expect(score.minimum).toBeUndefined();
    expect(score.maximum).toBeUndefined();
    // The source schema still carries them — providers that DO support the keywords use that object.
    const srcScore = ((ASSESSMENT_JSON_SCHEMA as Node).properties!.dimensions!.items as Node).properties!.score!;
    expect(srcScore.minimum).toBe(0);
    expect(srcScore.maximum).toBe(100);
  });

  it("does not mutate the source schema it derives from", () => {
    const src = objectNodes(ASSESSMENT_JSON_SCHEMA as Node);
    expect(src.every(([, n]) => n.additionalProperties === undefined)).toBe(true);
  });
});

describe("the contract cannot drift from the rubric", () => {
  it("derives the dimension-id enum from DIMENSIONS in both schemas", () => {
    const ids = DIMENSIONS.map((d) => d.id);
    const dimEnum = ((strict.properties!.dimensions!.items as Node).properties!.id ?? {}).enum;
    expect(dimEnum).toEqual(ids);
    expect(((strict.properties!.roadmap!.items as Node).properties!.dimension ?? {}).enum).toEqual(ids);
    // …and the tool description tells the model how many to return, from the same source.
    expect(ASSESSMENT_TOOL_DESCRIPTION).toContain(String(ids.length));
  });

  it("shares one impact/effort vocabulary with provider.ts's runtime accept-list", () => {
    const item = strict.properties!.roadmap!.items as Node;
    expect(item.properties!.impact!.enum).toEqual(IMPACT_LEVELS);
    expect(item.properties!.effort!.enum).toEqual(IMPACT_LEVELS);
  });
});

describe("assessmentResponseFormat", () => {
  it("requests strict json_schema decoding under a stable schema name", () => {
    const fmt = assessmentResponseFormat();
    expect(fmt.type).toBe("json_schema");
    expect(fmt.json_schema.strict).toBe(true);
    expect(fmt.json_schema.name).toBe(ASSESSMENT_SCHEMA_NAME);
    expect(fmt.json_schema.schema).toBe(STRICT_ASSESSMENT_JSON_SCHEMA);
  });

  it("keeps json_object as the portable fallback", () => {
    expect(JSON_OBJECT_RESPONSE_FORMAT).toEqual({ type: "json_object" });
  });
});

describe("isResponseFormatRejection — retry only on 'I don't support that'", () => {
  it.each([
    [400, "Invalid value for 'response_format'"],
    [400, "json_schema is not supported by this model"],
    [404, "structured output unavailable"],
    [422, "unsupported response_format"],
    [501, "structured_output not implemented"],
  ])("matches %i naming the field", (status, body) => {
    expect(isResponseFormatRejection(status, body)).toBe(true);
  });

  it.each([
    [401, "invalid api key"],
    [403, "insufficient permissions"],
    [429, "rate limit exceeded"],
    [500, "internal server error"],
    [503, "response_format overloaded"], // right words, wrong class — a 5xx is not a capability answer
  ])("does NOT match %i (a real failure must surface, never become a silent retry)", (status, body) => {
    expect(isResponseFormatRejection(status, body)).toBe(false);
  });

  it("does not match a 400 about something else entirely", () => {
    expect(isResponseFormatRejection(400, "model `gpt-9` does not exist")).toBe(false);
    expect(isResponseFormatRejection(400, "")).toBe(false);
  });
});
