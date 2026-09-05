// @vitest-environment jsdom
//
// The cohort behind this table is filtered by a recency floor (ENABLEMENT_MAX_IDLE_DAYS) that the
// reader cannot see in the rows. A list headed "the highest-leverage people to offer tooling to"
// that does not say how far back it looked invites the reader to assume it looked at everyone — so
// the horizon is part of the claim, and this pins it in the copy the reader actually meets.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { EnablementTargets } from "./EnablementTargets";
import { ENABLEMENT_MAX_IDLE_DAYS } from "@/lib/org/adoption";

const targets = [
  { login: "ada", name: "Ada", commits: 90, repos: 4, lastActiveAt: "2026-09-01T00:00:00.000Z" },
  { login: "bob", name: null, commits: 12, repos: 1, lastActiveAt: "2026-08-20T00:00:00.000Z" },
];

describe("EnablementTargets", () => {
  it("states the recency horizon the cohort was filtered on", () => {
    const { container } = render(<EnablementTargets targets={targets} nonePool={2} />);
    expect(container.textContent ?? "").toContain(`active in the last ${ENABLEMENT_MAX_IDLE_DAYS} days`);
  });

  it("says what it left out in the same terms, when the zero-AI pool is larger than the table", () => {
    const { container } = render(<EnablementTargets targets={targets} nonePool={22} />);
    const text = container.textContent ?? "";
    expect(text).toContain("22 contributors show no AI-attributed commits in total");
    expect(text).toContain(`active in the last ${ENABLEMENT_MAX_IDLE_DAYS} days`);
  });

  it("keeps the invitation framing, not a shortfall framing", () => {
    const { container } = render(<EnablementTargets targets={targets} nonePool={2} />);
    expect(container.textContent ?? "").toContain("not a to-do list for anyone");
  });
});
