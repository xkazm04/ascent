// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WarRoomHeader } from "./LiveWarRoomHeader";

// next/link needs the App Router context to render; the header only uses it for the goal "manage →"
// link (not exercised here), so stub it to a plain anchor.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

describe("WarRoomHeader live regions during a run", () => {
  it("keeps exactly ONE polite live region (the coalesced progress count), not a per-repo flood", () => {
    const { container } = render(
      <WarRoomHeader
        slug="acme"
        running
        watchedCount={10}
        progress={{ done: 3, total: 10, current: "acme/api" }}
        pct={30}
        error={null}
        skipped={0}
        onStop={() => {}}
      />,
    );

    // A full-fleet scan updates progress ~once per landed repo. Only the aggregate count may be a
    // live region; a second polite region for the currently-scanning name would double-announce and
    // flood a screen reader so it never finishes reading.
    const polite = container.querySelectorAll('[aria-live="polite"]');
    expect(polite).toHaveLength(1);
    expect(polite[0]).toHaveTextContent(/3\/10 repos/);

    // The currently-scanning caption still renders (visual status) but must NOT be a live region.
    const scanning = screen.getByText(/scanning/i);
    expect(scanning).not.toHaveAttribute("aria-live");
  });
});
