// @vitest-environment jsdom
//
// The cohort behind this table is filtered by a recency floor (ENABLEMENT_MAX_IDLE_DAYS) that the
// reader cannot see in the rows. A list headed "the highest-leverage people to offer tooling to"
// that does not say how far back it looked invites the reader to assume it looked at everyone — so
// the horizon is part of the claim.
//
// The /org redesign moved that claim from a paragraph into the picture: the BudgetPack draws the
// zero-AI pool as the budget and the omitted remainder as a labelled block carrying the horizon.
// These pin the claim at its new address, and that the "not a to-do list" framing stayed REACHABLE
// (a WhyChip) rather than being deleted.

import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EnablementTargets } from "./EnablementTargets";
import { ENABLEMENT_MAX_IDLE_DAYS } from "@/lib/org/adoption";

// The kit's charts read `prefers-reduced-motion` through useSyncExternalStore; jsdom has no
// matchMedia. Reduced-motion is the honest default for a test: entrances resolve immediately.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

const targets = [
  { login: "ada", name: "Ada", commits: 90, repos: 4, lastActiveAt: "2026-09-01T00:00:00.000Z" },
  { login: "bob", name: null, commits: 12, repos: 1, lastActiveAt: "2026-08-20T00:00:00.000Z" },
];

describe("EnablementTargets", () => {
  it("states the recency horizon the cohort was filtered on, where it left people out", () => {
    const { container } = render(<EnablementTargets targets={targets} nonePool={22} />);
    expect(container.textContent ?? "").toContain(`idle past ${ENABLEMENT_MAX_IDLE_DAYS} days`);
  });

  it("draws what it left out: the pool is the budget, the remainder an omission block", () => {
    const { container } = render(<EnablementTargets targets={targets} nonePool={22} />);
    const omission = container.querySelector('[data-omission="outside"]');
    expect(omission).toBeTruthy();
    // 22 in the zero-AI pool, 2 listed → 20 omitted, and the count is on screen, not implied.
    expect(container.textContent ?? "").toContain("20");
    expect(container.querySelector("[data-used]")).toBeTruthy();
  });

  it("omits the omission block entirely when nothing was left out", () => {
    const { container } = render(<EnablementTargets targets={targets} nonePool={2} />);
    expect(container.querySelector('[data-omission="outside"]')).toBeNull();
  });

  it("keeps the invitation framing reachable, not a shortfall framing", () => {
    render(<EnablementTargets targets={targets} nonePool={2} />);
    fireEvent.click(screen.getByRole("button", { name: /what this list is for/i }));
    expect(screen.getByRole("note").textContent ?? "").toContain("not a to-do list for anyone");
  });
});
