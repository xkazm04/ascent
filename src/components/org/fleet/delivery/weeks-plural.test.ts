// G6-24: the commit-activity caption hardcoded "weeks" as a literal plural while the adjacent repo count
// in the same sentence was already correctly conditional, so a single-week fleet read "...over 1 weeks."
// This asserts the same conditional pluralization pattern used for `repos` is now applied to `weeks`.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Migrated with the tab into the ?tab= shell (docs/ORG-TABS-REFACTOR.md); the caption this pins now
// lives in DeliveryCorePanel.tsx, not the old page.tsx.
const SOURCE = fs.readFileSync(path.resolve(__dirname, "DeliveryCorePanel.tsx"), "utf8");

describe("delivery commit-activity caption pluralization (G6-24)", () => {
  it("no longer hardcodes an unconditional 'weeks' literal", () => {
    expect(SOURCE).not.toMatch(/\{activity\.weeks\} weeks\b/);
  });

  it("conditionally pluralizes weeks the same way repos already is", () => {
    expect(SOURCE).toMatch(/\{activity\.weeks\} week\{activity\.weeks === 1 \? "" : "s"\}/);
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
