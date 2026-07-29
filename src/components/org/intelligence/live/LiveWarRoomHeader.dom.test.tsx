// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WarRoomHeader } from "@/components/org/intelligence/live/LiveWarRoomHeader";

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

// ── G6-08 — the progress bar can never overrun its track ─────────────────────
describe("WarRoomHeader progress bar clamp", () => {
  const base = {
    slug: "acme",
    running: true as const,
    watchedCount: 40,
    error: null,
    skipped: 0,
    onStop: () => {},
  };

  function bar(pct: number, progress = { done: 30, total: 12, current: "" }) {
    const { container } = render(<WarRoomHeader {...base} progress={progress} pct={pct} />);
    const track = container.querySelector('[role="progressbar"]')!;
    return { track, fill: track.firstElementChild as HTMLElement };
  }

  it("clamps an over-100 pct (credit-truncated run) in BOTH the width and aria-valuenow", () => {
    const { track, fill } = bar(250);
    expect(fill.style.width).toBe("100%");
    expect(track).toHaveAttribute("aria-valuenow", "100");
  });

  it("clamps a negative pct to the 3% sliver floor with aria-valuenow 0", () => {
    const { track, fill } = bar(-20);
    expect(fill.style.width).toBe("3%");
    expect(track).toHaveAttribute("aria-valuenow", "0");
  });

  it("leaves an in-range pct untouched", () => {
    const { track, fill } = bar(42);
    expect(fill.style.width).toBe("42%");
    expect(track).toHaveAttribute("aria-valuenow", "42");
  });
});

// ── G6-09 — the read-only / TV view offers no control it cannot honour ───────
describe("WarRoomHeader read-only (shared TV link) controls", () => {
  const base = {
    slug: "acme",
    watchedCount: 40,
    progress: { done: 0, total: 40, current: "" },
    pct: 0,
    error: null,
    skipped: 0,
    onStop: () => {},
    onLaunch: () => {},
    launchLabel: "▶ Launch live scan",
    sound: false,
    onToggleSound: () => {},
  };

  it("hides the Sound toggle on the read-only view, like every other control", () => {
    render(<WarRoomHeader {...base} running={false} readOnly canShare />);
    // The kiosk viewer has no scan to celebrate and no session to persist a preference against, so a
    // checkbox that can never fire is worse than no checkbox.
    expect(screen.queryByLabelText(/sound/i)).toBeNull();
    expect(screen.queryByText(/^Sound$/)).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    // ...and it stays consistent with the controls that were already gated.
    expect(screen.queryByText("▶ Launch live scan")).toBeNull();
    expect(screen.queryByText("Share TV link")).toBeNull();
  });

  it("still renders the Sound toggle on the authenticated wall", () => {
    render(<WarRoomHeader {...base} running={false} />);
    const box = screen.getByRole("checkbox");
    expect(box).toBeInTheDocument();
    expect(screen.getByText("Sound")).toBeInTheDocument();
  });

  it("fires onToggleSound when the authenticated wall's checkbox is clicked", () => {
    const onToggleSound = vi.fn();
    render(<WarRoomHeader {...base} running={false} onToggleSound={onToggleSound} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggleSound).toHaveBeenCalledTimes(1);
  });
});
