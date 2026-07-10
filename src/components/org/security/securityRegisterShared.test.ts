// The register variants share ONE sort + check-taxonomy contract. gradeTone drives the Matrix chip
// colors; failingChecks drives the "control coverage" sort; sortRows keeps ordering consistent.

import { describe, it, expect } from "vitest";
import { gradeTone, failingChecks, sortRows, CHECK_ORDER, type RegisterAdvisories } from "@/components/org/security/securityRegisterShared";
import type { SecurityRegisterRow, SecurityRowCheck } from "@/lib/org/security";

function check(over: Partial<SecurityRowCheck>): SecurityRowCheck {
  return { id: "x", name: "X", group: "posture", risk: "high", score: 5, detail: "", ...over };
}
function row(over: Partial<SecurityRegisterRow> = {}): SecurityRegisterRow {
  return { name: "r", fullName: `acme/${over.name ?? "r"}`, score: 50, gateReason: null, rules: null, checks: [], issues: [], summary: "", ...over };
}

describe("gradeTone — chip color by 0..10 grade", () => {
  it("green ≥7, amber 4–6, red <4, slate for n/a", () => {
    expect(gradeTone(10)).toBe("ok");
    expect(gradeTone(7)).toBe("ok");
    expect(gradeTone(6)).toBe("warn");
    expect(gradeTone(4)).toBe("warn");
    expect(gradeTone(3)).toBe("bad");
    expect(gradeTone(0)).toBe("bad");
    expect(gradeTone(null)).toBe("na");
  });
});

describe("failingChecks — the 'control coverage' sort proxy", () => {
  it("counts posture checks scoring <4; ignores exposure and n/a", () => {
    const r = row({
      checks: [
        check({ name: "SAST", score: 0 }), // fail
        check({ name: "Pinned", score: 3 }), // fail
        check({ name: "Branch", score: 9 }), // ok
        check({ name: "Vulns", group: "exposure", score: 0 }), // exposure — not counted
        check({ name: "Policy", score: null }), // n/a — not counted
      ],
    });
    expect(failingChecks(r)).toBe(2);
  });

  it("the exposure check has a distinct group so it can be rendered apart", () => {
    expect(CHECK_ORDER.find((c) => c.id === "known-vulnerabilities")!.group).toBe("exposure");
    expect(CHECK_ORDER.filter((c) => c.group === "posture").length).toBeGreaterThan(5);
  });
});

describe("sortRows — shared ordering", () => {
  const rows = [row({ name: "a", score: 30 }), row({ name: "b", score: 70 }), row({ name: "c", score: 50 })];
  const adv: Map<string, RegisterAdvisories> = new Map([["acme/b", { fullName: "acme/b", critical: 0, high: 0, total: 9 }]]);

  it("risk+asc returns the server order verbatim (stable no-op)", () => {
    expect(sortRows(rows, "risk", "asc", null)).toBe(rows);
  });
  it("score+asc is weakest-first", () => {
    expect(sortRows(rows, "score", "asc", null).map((r) => r.score)).toEqual([30, 50, 70]);
  });
  it("gaps+desc puts the most-failing repo first", () => {
    const withGaps = [
      row({ name: "clean", checks: [check({ score: 9 })] }),
      row({ name: "broken", checks: [check({ score: 0 }), check({ score: 1 })] }),
    ];
    expect(sortRows(withGaps, "gaps", "desc", null)[0]!.name).toBe("broken");
  });
  it("adv sorts by advisory total", () => {
    expect(sortRows(rows, "adv", "desc", adv)[0]!.name).toBe("b");
  });
});
