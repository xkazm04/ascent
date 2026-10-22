// THE AGENT-DOOR EGRESS for tool results - the MCP door's half of the rule Athena already applies.
//
// Two doors serve the same handlers. Athena (src/lib/athena/grounding.ts) quotes an org-authored
// result to her model through `sanitizeAgentText`, which redacts credential shapes first. The MCP
// route used to hand the very same result to an external coding agent verbatim, so a token an agent
// pasted into a lesson while debugging reached every later caller of `get_skill_lessons` - and that
// caller's model vendor, an egress the org never chose. "Masked on one screen, raw on the other" is
// the defect; this module closes it.
//
// ONE REDACTION RULE. Every string leaf goes through `redactSecrets` (src/lib/security/redact.ts),
// the same masker `sanitizeAgentText` runs. Only the redaction half of that function applies here:
// `neutralize` and `wrapUntrusted` shape a PROMPT, and injecting a fence or rewriting backticks inside
// a JSON result would change what an external client parses. The boundary this door owes its caller
// is data with provenance, stated in `_meta`, not a prompt fence.
//
// SHAPE-PRESERVING. Keys, numbers, booleans, nulls and nesting pass through untouched; only string
// leaves can change, and only by a substring becoming `[REDACTED]`. A result is backward compatible
// by construction: an agent that parsed it before parses it now, and reads less.
//
// KEYED ON AUTHORSHIP, NOT SHAPE. A `computed` tool's result is ascent's own arithmetic and is returned
// as the same object, byte for byte. The catalog field (`McpToolDef.resultTrust`) says which is which,
// and a structural test pins its org-authored set to Athena's so the two doors cannot drift.

import { REDACTED, redactSecrets } from "@/lib/security/redact";
import type { ToolResult } from "./tool-result";

/** Who wrote the text in a tool's result: ascent (`computed`) or the org, its members and agents. */
export type ResultTrust = "computed" | "org-authored";

/** Namespaced, additive `_meta` keys on a `tools/call` result. */
export const PROVENANCE_META_KEY = "ascent.dev/provenance";
export const REDACTIONS_META_KEY = "ascent.dev/redactions";

function markers(s: string): number {
  return s.split(REDACTED).length - 1;
}

/**
 * `value` with every string leaf passed through `redactSecrets`, plus how many credential shapes were
 * masked (markers added, so text that already carried `[REDACTED]` does not count). Pure: the input is
 * never mutated; object keys are not leaves and are never rewritten.
 */
export function redactLeaves(value: unknown): { value: unknown; redactions: number } {
  if (typeof value === "string") {
    const out = redactSecrets(value);
    return { value: out, redactions: Math.max(0, markers(out) - markers(value)) };
  }
  if (Array.isArray(value)) {
    let redactions = 0;
    const out = value.map((v) => {
      const r = redactLeaves(v);
      redactions += r.redactions;
      return r.value;
    });
    return { value: out, redactions };
  }
  if (value !== null && typeof value === "object") {
    let redactions = 0;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const r = redactLeaves(v);
      redactions += r.redactions;
      out[k] = r.value;
    }
    return { value: out, redactions };
  }
  return { value, redactions: 0 };
}

export interface EgressedResult {
  result: ToolResult;
  /** Present only for an org-authored tool: the keys to merge into the call result's `_meta`. */
  meta?: Record<string, unknown>;
}

/**
 * The result as it may leave the agent door. `computed`: the same object back, no meta. `org-authored`:
 * `structuredContent` and any explicit `text` redacted, and meta naming the provenance and the count.
 *
 * The count is the larger of the two renderings', not their sum: a `fail()` result states its message
 * in both, and one secret shown twice is one redaction. A non-zero count is also how a caller of
 * `get_skill` learns its `content` no longer hashes to `contentHash` - the hash is the stored body's,
 * left as it was so a registry comparison still keys on the real file.
 */
export function egressResult(def: { resultTrust: ResultTrust }, result: ToolResult): EgressedResult {
  if (def.resultTrust !== "org-authored") return { result };
  const sc = redactLeaves(result.structuredContent);
  const out: ToolResult = { ...result, structuredContent: sc.value };
  let textRedactions = 0;
  if (typeof result.text === "string") {
    const t = redactLeaves(result.text);
    out.text = t.value as string;
    textRedactions = t.redactions;
  }
  return {
    result: out,
    meta: { [PROVENANCE_META_KEY]: "org-authored", [REDACTIONS_META_KEY]: Math.max(sc.redactions, textRedactions) },
  };
}

/**
 * Merge `meta` into a JSON-RPC envelope's `result._meta`, beside the server identity `ok()` already
 * stamped there. Additive: an existing key is never replaced, so the protocol's own entries survive.
 */
export function stampResultMeta(envelope: Record<string, unknown>, meta: Record<string, unknown>): Record<string, unknown> {
  const result = (envelope.result ?? {}) as Record<string, unknown>;
  const existing = (result._meta ?? {}) as Record<string, unknown>;
  return { ...envelope, result: { ...result, _meta: { ...meta, ...existing } } };
}
