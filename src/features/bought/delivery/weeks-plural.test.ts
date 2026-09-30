// G6-24: the commit-activity caption hardcoded "weeks" as a literal plural while the adjacent repo count
// in the same sentence was already correctly conditional, so a single-week fleet read "...over 1 weeks."
// This asserts the same conditional pluralization pattern used for `repos` is now applied to `weeks`.
// Both compositions carry the caption: Altimeter in DeliveryCore.v1, Prism in DeliveryActivity.v2.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (name: string) => fs.readFileSync(path.resolve(__dirname, name), "utf8");

describe.each([
  ["DeliveryCore.v1.tsx", read("DeliveryCore.v1.tsx")],
  ["DeliveryActivity.v2.tsx", read("DeliveryActivity.v2.tsx")],
])("delivery commit-activity caption pluralization (G6-24) in %s", (_name, SOURCE) => {
  it("no longer hardcodes an unconditional 'weeks' literal", () => {
    expect(SOURCE).not.toMatch(/\{activity\.weeks\} weeks\b/);
  });

  // The /org redesign reduced the caption to a unit/window line (§2.3), so the same conditional now
  // lives in a template literal rather than in JSX children. The INVARIANT is unchanged and this
  // matches either spelling — a source-scanning check that only knows one syntax reports a clean
  // codebase in a voice indistinguishable from success (AGENTS.md).
  it("conditionally pluralizes weeks the same way repos already is", () => {
    expect(SOURCE).toMatch(/[{$]\{?activity\.weeks\} week\$?\{\s*activity\.weeks === 1 \? "" : "s"\s*\}/);
  });
});

describe("pluralization helper behavior", () => {
  const label = (weeks: number) => `${weeks} week${weeks === 1 ? "" : "s"}`;

  it("reads singular for exactly one week", () => {
    expect(label(1)).toBe("1 week");
  });

  it("reads plural for zero or many weeks", () => {
    expect(label(0)).toBe("0 weeks");
    expect(label(4)).toBe("4 weeks");
  });
});
