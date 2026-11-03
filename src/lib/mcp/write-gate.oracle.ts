// A second, independent model of the write door's policy — the oracle write-gate.matrix.test.ts
// compares `assertWriteAllowed` against over the whole bounded input product.
//
// WRITTEN FROM THE CONTRACT, NOT FROM THE FUNCTION. The contract is write-gate.ts's header ("WHAT A
// WRITE MUST CLEAR, in this order") plus the two refusals the header does not number (a tool with no
// policy row, a write with no token). The model does not know the order the implementation checks in:
// it predicts the SET of rules an input violates, and the matrix asserts that the rule the door
// reported is one of them. Precedence is asserted only where the contract DECLARES it, so reordering
// two refusals the contract leaves unordered is a refactor, not a failure.
//
// SHARED: the rule VOCABULARY (`WriteDenialRule`, one authority, in write-gate.ts) and the policy
// table's rows, which are data. NOT SHARED: the logic that decides which rules an input violates.

import type { SkillTokenScope } from "@/lib/db";
import { WRITE_TOOL_POLICY, type WriteDenialRule, type WriteGateInput } from "./write-gate";

/**
 * The precedence the contract declares, and only that: telemetry:write, then the resource scope, then
 * the plan gate, then the ceiling. The resource-scope-before-plan edge is the one with teeth: a token
 * that cannot read a resource must be told about its scope, never about the workspace's plan for that
 * resource — the door keeps what an org has opaque to a token that cannot reach it.
 * `unattributable` and `unregistered-tool` are unordered against the rest.
 */
const DECLARED_ORDER: readonly WriteDenialRule[] = [
  "missing-write-scope",
  "missing-resource-scope",
  "plan-closed",
  "daily-ceiling",
];

/** True when the contract says `before` must be reported ahead of `after` when both are violated. */
export function mustPrecede(before: WriteDenialRule, after: WriteDenialRule): boolean {
  const a = DECLARED_ORDER.indexOf(before);
  const b = DECLARED_ORDER.indexOf(after);
  return a >= 0 && b >= 0 && a < b;
}

const hasRow = (tool: string) => Object.prototype.hasOwnProperty.call(WRITE_TOOL_POLICY, tool);

/** Every rule this input violates. An empty set means the write must be allowed. */
export function predictViolations(input: WriteGateInput): Set<WriteDenialRule> {
  const out = new Set<WriteDenialRule>();
  const held = new Set<string>(input.scopes);
  if (!held.has("telemetry:write")) out.add("missing-write-scope");
  if (!input.tokenId) out.add("unattributable");
  if (!hasRow(input.tool)) {
    out.add("unregistered-tool");
    return out;
  }
  const p = WRITE_TOOL_POLICY[input.tool]!;
  if (!held.has(p.resourceScope)) out.add("missing-resource-scope");
  if (p.planGate && !input.gates[p.planGate]) out.add("plan-closed");
  if (input.writesToday !== null && input.writesToday >= p.perTokenDailyMax) out.add("daily-ceiling");
  return out;
}

const OPTIONAL_SCOPES = ["telemetry:write", "followups:write", "memory:read", "skills:read"] as SkillTokenScope[];

/**
 * Tool names with no policy row. `constructor` and `toString` are here on purpose: they are the
 * names a bare `record[name]` lookup resolves to something truthy.
 */
const UNREGISTERED_TOOLS = ["not_a_write_tool", "constructor", "toString"];

export interface MatrixCase {
  index: number;
  input: WriteGateInput;
}

/** The whole bounded product: tool x scope subset x plan gates x token x writes-today. */
export function* writeGateMatrix(): Generator<MatrixCase> {
  const tools = [...Object.keys(WRITE_TOOL_POLICY).sort(), ...UNREGISTERED_TOOLS];
  let index = 0;
  for (const tool of tools) {
    const max = hasRow(tool) ? WRITE_TOOL_POLICY[tool]!.perTokenDailyMax : 100;
    for (let mask = 0; mask < 1 << OPTIONAL_SCOPES.length; mask++) {
      const scopes = ["mcp:read", ...OPTIONAL_SCOPES.filter((_, i) => mask & (1 << i))] as SkillTokenScope[];
      for (const memory of [true, false]) {
        for (const skills of [true, false]) {
          for (const tokenId of ["tok_1", null]) {
            for (const writesToday of [null, 0, max - 1, max, max + 1]) {
              yield { index: index++, input: { tool, scopes, gates: { memory, skills }, tokenId, writesToday } };
            }
          }
        }
      }
    }
  }
}

export function describeCase(c: MatrixCase): string {
  const i = c.input;
  return `#${c.index} ${i.tool} scopes=${i.scopes.join("+")} gates=${JSON.stringify(i.gates)} token=${i.tokenId} today=${i.writesToday}`;
}
