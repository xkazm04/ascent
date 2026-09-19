// @vitest-environment jsdom
//
// G6-21 — the movers ticker must NOT be a live region.
//
// Every landed repo prepends an <li>. On a 40-repo fleet scan a polite <ul> queues one announcement
// per row ("acme-api, up 4, 62", "acme-web, scan failed", …) on top of the header's per-repo
// progress count. Screen readers do not drop a polite backlog: NVDA/JAWS keep reading it, so the
// ticker is still speaking rows minutes after the run ended, and the user cannot hear anything else
// in the meantime. The row content is also the LEAST useful thing to hear — a bare per-repo score
// with no fleet context — which is why the remedy is removal plus a settled summary elsewhere
// (HeadlineStrip), not throttling.

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MoversTicker } from "@/features/inflight/live/LiveWarRoomPanels";
import type { Mover } from "@/components/org/shared/liveWarRoomShared";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

const mover = (i: number): Mover => ({
  id: i,
  fullName: `acme/repo-${i}`,
  name: `repo-${i}`,
  overall: 60 + i,
  delta: 4,
  level: "Practicing",
  posture: "ai-native",
  failed: false,
  skipped: false,
});

describe("MoversTicker accessibility (G6-21)", () => {
  it("declares NO live region, however many results have landed", () => {
    const ticker = Array.from({ length: 40 }, (_, i) => mover(i));
    const { container } = render(<MoversTicker ticker={ticker} running />);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(0);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    // The rows are all still THERE — this is a silencing fix, not a content fix.
    expect(container.querySelectorAll("li")).toHaveLength(40);
  });

  it("gives the list an accessible name so a screen-reader user can still find it on demand", () => {
    const { container } = render(<MoversTicker ticker={[mover(1), mover(2)]} running />);
    const list = container.querySelector("ul")!;
    expect(list).not.toHaveAttribute("aria-live");
    expect(list.getAttribute("aria-label")).toBe("Live movers, most recent first: 2 results");
  });

  it("singularises the accessible name for a single result", () => {
    const { container } = render(<MoversTicker ticker={[mover(1)]} running />);
    expect(container.querySelector("ul")!.getAttribute("aria-label")).toBe("Live movers, most recent first: 1 result");
  });

  it("keeps the empty state silent too", () => {
    const { container } = render(<MoversTicker ticker={[]} running />);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(0);
  });
});
