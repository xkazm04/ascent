// The validity table the typed-filter language is proven by: one row per typing rule and per syntax
// error, run through the same door the product uses. The negative rows are the point — the pass is
// proven by what it refuses. Shared by the RulesPanel (rendered live) and rules.test.ts (asserted).

export type ValidityRow = { src: string; verdict: "ok" | "refused"; why: string };

export const VALIDITY_TABLE: readonly ValidityRow[] = [
  { src: 'status == "fail" and level < 3', verdict: "ok", why: "bool and bool" },
  { src: 'tags contains "core" or findings >= 10', verdict: "ok", why: "list contains string; int >= int" },
  { src: 'name matches /^auth/ and not archived', verdict: "ok", why: "string matches regex; not bool" },
  { src: 'owner + "-" + lang == "atlas-go"', verdict: "ok", why: "string + anything is a string" },
  { src: "level + true", verdict: "refused", why: "int + bool" },
  { src: 'name - 1', verdict: "refused", why: "string - int" },
  { src: "tags < 5", verdict: "refused", why: "comparison of a list to an int" },
  { src: 'tier == "gold"', verdict: "refused", why: "unknown identifier" },
  { src: 'lang == 5', verdict: "refused", why: "equality across types is not coerced" },
  { src: 'tags contains ["core"', verdict: "refused", why: "unclosed list" },
  { src: "level + 1", verdict: "refused", why: "well-formed, types to int: not a filter" },
];

/** Rules persisted before this session. One was saved under a schema that has since retired `tier`. */
export type SeedRule = { id: string; name: string; src: string };
/** Non-empty by type: the panel opens on the first rule. */
export const SEED_RULES: readonly [SeedRule, ...SeedRule[]] = [
  { id: "rule-1", name: "Failing, low tier", src: 'status == "fail" and level < 3' },
  { id: "rule-2", name: "Regulated core", src: 'tags contains "regulated" or tags contains "core"' },
  { id: "rule-3", name: "Gold tier (2025)", src: 'tier == "gold" and not archived' },
];
