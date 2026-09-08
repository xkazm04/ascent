// @vitest-environment jsdom
//
// The care section's privacy guarantee used to be a promise ("never who, and never a per-person
// row"). It is now a column of voids: nothing is drawn where an identity would be. This pins that —
// the whole "Per-person row" axis must be `missing` at EVERY population size, and the rows that never
// leave the developer's machine must be void on both axes.

import { beforeAll, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CarePrivacyLedger } from "./CarePrivacyLedger";
import { emptyOrgView, type CareOrgView } from "@/lib/org/developer-view";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

function view(over: Partial<CareOrgView> = {}): CareOrgView {
  return { ...emptyOrgView(9), belowFloor: false, ...over };
}

const PERSON_CELLS = ["setup", "sharing", "moves", "asks", "shape", "transcripts", "prompts", "who"];

describe("CarePrivacyLedger", () => {
  it("draws every per-person cell as a void, above the floor", () => {
    const { container } = render(<CarePrivacyLedger org={view()} />);
    for (const id of PERSON_CELLS) {
      const cell = container.querySelector(`[data-cell="${id}:Per-person row"]`);
      expect(cell?.getAttribute("data-state"), id).toBe("missing");
      // A void draws no mark at all — that absence is the encoding.
      expect(cell?.querySelector("[data-mark]"), id).toBeNull();
    }
  });

  it("keeps the never-sent rows void on BOTH axes", () => {
    const { container } = render(<CarePrivacyLedger org={view()} />);
    for (const id of ["transcripts", "prompts", "who"]) {
      expect(container.querySelector(`[data-cell="${id}:Counted here"]`)?.getAttribute("data-state")).toBe("missing");
    }
  });

  it("hatches the counted column below the floor — suppressed is not absent, and prints no value", () => {
    const { container } = render(<CarePrivacyLedger org={view({ belowFloor: true, population: 2 })} />);
    const cell = container.querySelector('[data-cell="setup:Counted here"]');
    expect(cell?.getAttribute("data-state")).toBe("not-judged");
    expect(cell?.querySelector("[data-score]")).toBeNull();
    // Still a void on the identity axis: the floor changes what is counted, never what is nameable.
    expect(container.querySelector('[data-cell="setup:Per-person row"]')?.getAttribute("data-state")).toBe("missing");
  });
});
