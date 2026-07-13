// Locks csvField's two jobs: spreadsheet formula-injection neutralization AND the exemption that keeps
// a legitimate signed number (e.g. a negative avgDelta) from being mangled as if it were a formula.

import { describe, it, expect } from "vitest";
import { csvField } from "./csv";

describe("csvField — formula-injection guard", () => {
  it.each(["=HYPERLINK(0)", "+cmd|'/c calc'", "-1+1", "@SUM(A1)"])(
    "neutralizes a non-numeric leading =/+/-/@ formula %s",
    (v) => {
      expect(csvField(v)).toBe(`"'${v}"`);
    },
  );

  it("doubles embedded quotes inside a neutralized formula", () => {
    expect(csvField('=1+"2"')).toBe('"\'=1+""2"""');
  });
});

describe("csvField — negative/signed numbers are data, not formulas (pdf-llm-export #5)", () => {
  it.each([-40, -40.5, -0.5, 3, 3.14, 1e3, -2.5e-3])(
    "leaves the numeric value %s intact (no leading quote, no wrapping)",
    (n) => {
      expect(csvField(n)).toBe(String(n));
    },
  );

  it("a numeric STRING that starts with - is also exempt", () => {
    expect(csvField("-40")).toBe("-40");
    expect(csvField("+15")).toBe("+15");
  });

  it("but a number-then-junk value is still guarded (not truly numeric)", () => {
    expect(csvField("-40=cmd")).toBe(`"'-40=cmd"`);
  });
});

describe("csvField — RFC-4180 quoting", () => {
  it("quotes a value containing a comma, quote, or newline and doubles quotes", () => {
    expect(csvField('Doe, "Jane"\nInc')).toBe('"Doe, ""Jane""\nInc"');
  });

  it("leaves a plain value unquoted, and alwaysQuote wraps everything", () => {
    expect(csvField("octocat")).toBe("octocat");
    expect(csvField("octocat", true)).toBe('"octocat"');
  });

  it("degrades a String()-throwing value to an empty cell", () => {
    const hostile = { toString() { throw new Error("boom"); } };
    expect(csvField(hostile)).toBe("");
  });
});
