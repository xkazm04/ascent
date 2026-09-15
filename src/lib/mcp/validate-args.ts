// ARGUMENTS ARE VALIDATED AT THE DOOR — the enforcement half of the catalog's schemas.
//
// WHY THIS EXISTS. `inputSchema` on every `McpToolDef` declares `additionalProperties: false`,
// `minimum`/`maximum`, `enum`, `required` and item types, and until this module the ONLY consumer of
// any of it was `toWireTool` — the schemas were ADVERTISED to the model and enforced nowhere. A tool
// schema is a contract, and a contract nobody checks is a description of intentions: `leaseMinutes:
// 0` sailed past a declared `minimum: 5`, an eleventh id in `ids` was silently dropped, and an
// undeclared `actor` was read straight out of the argument bag and written to a row.
//
// THE SUBSET IS DELIBERATE. This validates exactly the JSON Schema keywords THIS catalog uses, and
// nothing more — a general-purpose validator would be a dependency and a much larger surface to get
// wrong. `tools.test.ts` is the guard on the other side: a keyword that appears in the catalog and
// not here is a keyword the door does not keep. Anything unrecognized is simply not checked, which is
// the honest failure mode (advertise less than you enforce is the direction that cannot hurt).
//
// A VIOLATION IS AN IN-BAND RESULT, NOT A PROTOCOL ERROR. The caller is a model, and a model can fix
// a wrong argument if it is told which one and which rule — that is a tool-execution error on a 200,
// exactly like a plan refusal. A JSON-RPC `-32602` would tell the model's HARNESS the request was
// malformed, which is a different (and here, wrong) claim: the request was well-formed, its argument
// was not.

/** A JSON-Schema-ish node, as the catalog writes them. Everything is optional; unknown keys ignored. */
interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxItems?: number;
  items?: SchemaNode;
}

const asNode = (v: unknown): SchemaNode | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as SchemaNode) : null;

/** The article-free type name a message should use for `type`. */
function typeOk(value: unknown, type: string | undefined): boolean {
  if (!type) return true;
  switch (type) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    default:
      // An unmodelled type is not enforced rather than guessed at — see the header.
      return true;
  }
}

const shown = (v: unknown): string => (typeof v === "string" ? JSON.stringify(v) : Array.isArray(v) ? "an array" : String(v));

/** One property against its node. Returns the sentence, or null when it holds. */
function checkValue(path: string, value: unknown, node: SchemaNode): string | null {
  if (!typeOk(value, node.type)) {
    return `\`${path}\` must be ${node.type === "integer" ? "an integer" : `a ${node.type}`}; you sent ${shown(value)}.`;
  }
  if (Array.isArray(node.enum) && !node.enum.includes(value)) {
    return `\`${path}\` must be one of ${node.enum.map((e) => JSON.stringify(e)).join(", ")}; you sent ${shown(value)}.`;
  }
  if (typeof value === "number") {
    if (typeof node.minimum === "number" && value < node.minimum) {
      return `\`${path}\` must be at least ${node.minimum}; you sent ${value}.`;
    }
    if (typeof node.maximum === "number" && value > node.maximum) {
      return `\`${path}\` must be at most ${node.maximum}; you sent ${value}.`;
    }
  }
  if (typeof value === "string" && typeof node.minLength === "number" && value.length < node.minLength) {
    return `\`${path}\` must be at least ${node.minLength} character${node.minLength === 1 ? "" : "s"} long.`;
  }
  if (Array.isArray(value)) {
    if (typeof node.maxItems === "number" && value.length > node.maxItems) {
      // NAMED, NEVER TRUNCATED. `claim_followups` used to slice the 11th id away, so it appeared in
      // neither `claimed` nor `refused` and the caller believed it held a row nobody had leased.
      return `\`${path}\` takes at most ${node.maxItems} item${node.maxItems === 1 ? "" : "s"}; you sent ${value.length}. Send the rest in a second call.`;
    }
    const items = asNode(node.items);
    if (items) {
      for (let i = 0; i < value.length; i += 1) {
        const bad = checkValue(`${path}[${i}]`, value[i], items);
        if (bad) return bad;
      }
    }
  }
  return null;
}

/**
 * Validate one tool call's arguments against its declared `inputSchema`.
 *
 * Returns the FIRST violation as a sentence naming the argument and the rule, or `null` when the
 * arguments conform. One at a time on purpose: a model fixes one argument and calls again, and a
 * list of five complaints about a call it will re-make anyway is noise in a context window.
 */
export function validateArgs(schema: unknown, args: Record<string, unknown>): string | null {
  const root = asNode(schema);
  if (!root) return null; // no schema declared → nothing to enforce

  for (const key of root.required ?? []) {
    if (args[key] === undefined) return `\`${key}\` is required.`;
  }

  const props = root.properties ?? {};
  if (root.additionalProperties === false) {
    const declared = new Set(Object.keys(props));
    // Sorted so the same malformed call always produces the same sentence — a model retrying against
    // a message that changes shape between attempts learns nothing from it.
    const extra = Object.keys(args).filter((k) => !declared.has(k)).sort();
    if (extra.length > 0) {
      return `\`${extra[0]}\` is not an argument of this tool. It takes ${
        declared.size ? [...declared].sort().map((d) => `\`${d}\``).join(", ") : "no arguments"
      }.`;
    }
  }

  for (const [key, raw] of Object.entries(props)) {
    const value = args[key];
    if (value === undefined) continue; // absence is the required check's business, above
    const node = asNode(raw);
    if (!node) continue;
    const bad = checkValue(key, value, node);
    if (bad) return bad;
  }
  return null;
}
