// @vitest-environment jsdom
//
// `CareOrgView.population` is the git contributor snapshot, the same naming-floor denominator the
// rest of Contributors uses. The Care band used to call that count an opt-in ("could opt in",
// "N developers opted in"), which told the org that committing was consent. Sharing is
// `adoption.sharing`; this pins the git count as a snapshot.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { CareOrgAdoptionTiles, CareOrgSuppressed } from "./CareOrgAggregate";
import { emptyOrgView } from "@/lib/org/developer-view";

const OPT_IN = /opt-?in/i;

const BAND_FILES = [
  "CareOrgAggregate.tsx",
  "CareOrgBandStrips.tsx",
  "CarePrivacyLedger.tsx",
  "ContributorsCareSection.tsx",
];

describe("Contributors care band — git count is not an opt-in", () => {
  it("has no opt-in claim in the band's source", () => {
    for (const file of BAND_FILES) {
      const src = fs.readFileSync(path.resolve(__dirname, file), "utf8");
      expect(src, file).not.toMatch(OPT_IN);
    }
  });

  it("names an empty snapshot, not a missing share", () => {
    const { container } = render(<CareOrgSuppressed org={emptyOrgView(0)} />);
    const text = container.textContent ?? "";
    expect(text).toContain("git snapshot");
    expect(text).toContain("No contributors in this workspace yet");
    expect(text).not.toMatch(OPT_IN);
    expect(text).not.toMatch(/shared anything/i);
  });

  it("names a below-floor git count, not people who opted in", () => {
    const { container } = render(<CareOrgSuppressed org={emptyOrgView(2)} />);
    const text = container.textContent ?? "";
    expect(text).toContain("2 contributors in the git snapshot");
    expect(text).toContain("below the floor of 3");
    expect(text).not.toMatch(OPT_IN);
    expect(text).not.toMatch(/opted/i);
  });

  it("labels the Developers tile as the git snapshot, not people who could opt in", () => {
    const org = { ...emptyOrgView(9), belowFloor: false };
    const { container } = render(<CareOrgAdoptionTiles org={org} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Developers");
    expect(text).toContain("in the git snapshot");
    expect(text).not.toMatch(OPT_IN);
    expect(text).not.toContain("could opt in");
  });
});
