// Locks csvField's two jobs: spreadsheet formula-injection neutralization AND the exemption that keeps
// a legitimate signed number (e.g. a negative avgDelta) from being mangled as if it were a formula.

import { describe, it, expect } from "vitest";
import { csvField, csvTable } from "./csv";

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

// csvTable is the canonical row/table assembly extracted (G8-35) out of org/export, org/repositories,
// history, and usage — this pins its exact byte shape (comma header, per-cell csvField encoding,
// "\n"-joined rows, single trailing newline, no BOM/CRLF) so a future edit can't silently regress the
// four export routes that now share it.
describe("csvTable — canonical row/table assembly", () => {
  it("joins the header and encodes every cell via csvField, with a single trailing newline", () => {
    const out = csvTable(["a", "b"], [
      [1, 2],
      ["x,y", 'he"llo'],
    ]);
    expect(out).toBe('a,b\n1,2\n"x,y","he""llo"\n');
  });

  it("emits no BOM and uses bare LF (not CRLF) line endings", () => {
    const out = csvTable(["a"], [["1"], ["2"]]);
    expect(out.charCodeAt(0)).not.toBe(0xfeff);
    expect(out).not.toContain("\r");
    expect(out.split("\n")).toEqual(["a", "1", "2", ""]);
  });

  it("returns just the header + trailing newline for zero rows", () => {
    expect(csvTable(["a", "b"], [])).toBe("a,b\n");
  });

  it("neutralizes a formula-leading cell and preserves plain signed numbers (delegates to csvField)", () => {
    const out = csvTable(["v"], [["=HYPERLINK(0)"], [-40]]);
    expect(out).toBe('v\n"\'=HYPERLINK(0)"\n-40\n');
  });
});
