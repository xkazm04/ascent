// The write door against an independent model, over every input in a bounded product (4,480 cases).
//
// The hand-written cases in write-gate.test.ts pin one fault at a time and match the refusal's prose
// by regex. This matrix asks the question they cannot: for EVERY combination, did the door refuse for
// a reason the contract allows? A refusal is compared by its typed `rule`, never by its sentence, so
// rewording a message is not a failure and copying one refusal's return into another branch is.
//
// Five ways to fail, each its own finding:
//   unpredicted-accept      the model says refuse, the door allowed
//   unpredicted-reject      the model says allow, the door refused
//   unknown-rule            the door refused with a rule outside the vocabulary
//   wrong-rule              the door refused for a rule this input does not violate
//   precedence              the door reported a rule the contract says must come after another
//                           rule this input also violates

import { describe, expect, it } from "vitest";
import type { SkillTokenScope } from "@/lib/db";
import { assertWriteAllowed, WRITE_DENIAL_RULES, type WriteDenialRule } from "./write-gate";
import { describeCase, mustPrecede, predictViolations, writeGateMatrix } from "./write-gate.oracle";

type Mismatch = "unpredicted-accept" | "unpredicted-reject" | "unknown-rule" | "wrong-rule" | "precedence";

function compare(expected: Set<WriteDenialRule>, denial: ReturnType<typeof assertWriteAllowed>): Mismatch | null {
  if (expected.size === 0) return denial ? "unpredicted-reject" : null;
  if (!denial) return "unpredicted-accept";
  if (!(WRITE_DENIAL_RULES as readonly string[]).includes(denial.rule)) return "unknown-rule";
  if (!expected.has(denial.rule)) return "wrong-rule";
  for (const other of expected) if (mustPrecede(other, denial.rule)) return "precedence";
  return null;
}

describe("assertWriteAllowed — exhaustive matrix against the contract model", () => {
  it("refuses exactly when the model says, and for a reason the contract allows", () => {
    const failures: string[] = [];
    const kinds: Partial<Record<Mismatch, number>> = {};
    let cases = 0;
    let refused = 0;
    for (const c of writeGateMatrix()) {
      cases++;
      const expected = predictViolations(c.input);
      const denial = assertWriteAllowed(c.input);
      if (denial) refused++;
      const kind = compare(expected, denial);
      if (!kind) continue;
      kinds[kind] = (kinds[kind] ?? 0) + 1;
      if (failures.length < 5) {
        failures.push(`${kind} ${describeCase(c)} expected=${[...expected].join("+") || "allow"} got=${denial?.rule ?? "allow"}`);
      }
    }
    expect({ kinds, failures }).toEqual({ kinds: {}, failures: [] });
    // The instrument's own floor: a matrix that never refused, or never allowed, has tested one side.
    expect(cases).toBe(4480);
    expect(refused).toBeGreaterThan(0);
    expect(refused).toBeLessThan(cases);
  });

  it("the model and the door agree on the one fully-open write per tool", () => {
    for (const tool of ["claim_followups", "report_attempt"]) {
      const input = {
        tool,
        scopes: ["mcp:read", "telemetry:write", "followups:write"] as SkillTokenScope[],
        gates: { memory: false, skills: false },
        tokenId: "tok_1",
        writesToday: 0,
      };
      expect(predictViolations(input).size).toBe(0);
      expect(assertWriteAllowed(input)).toBeNull();
    }
  });
});
