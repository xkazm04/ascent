// @vitest-environment jsdom
//
// A field shared by fewer people than a band needs is named as withheld, not drawn thin and not
// folded into "nobody has shared these counts" (study 2026-09-15, T6).

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CareOrgBands } from "./CareOrgBandStrips";
import { emptyOrgView } from "@/lib/org/developer-view";

describe("CareOrgBands: the sharer floor", () => {
  it("names a withheld field instead of claiming nobody shared", () => {
    const org = { ...emptyOrgView(12), belowFloor: false, bandGaps: { planModePct: "below-sharer-floor" as const } };
    const { container } = render(<CareOrgBands org={org} />);
    expect(container.querySelector("[data-band-withheld]")?.textContent).toContain("No band for Plan mode");
    expect(container.textContent).toContain("fewer than 5 people");
    expect(container.textContent).not.toContain("nobody has shared");
  });

  it("keeps the empty state when no field was shared at all", () => {
    const { container } = render(<CareOrgBands org={{ ...emptyOrgView(12), bandGaps: { planModePct: "no-sharers" } }} />);
    expect(container.querySelector("[data-band-withheld]")).toBeNull();
    expect(container.textContent).toContain("nobody has shared");
  });
});
