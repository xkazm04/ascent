// @vitest-environment jsdom
//
// ABOUT #1: switching the segment filter used to strand a pinned inspection. When the pinned cell fell
// outside the new slice it became `disabled` (off-slice), so its own clear-toggle could never fire and
// hover stayed frozen — leaving a stale "pinned" readout that couldn't be dismissed. This pins the fix.

import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FleetGrid } from "./FleetGrid";

// framer-motion needs two browser APIs jsdom doesn't implement: window.matchMedia (useReducedMotion)
// and IntersectionObserver (useInView / whileInView). Stub both. The IO stub never fires its callback,
// so cells stay at their initial reveal state — still fully in the DOM, which is all these queries need.
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!("IntersectionObserver" in window)) {
    class IO {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
  }
});

describe("FleetGrid segment filter vs. a pinned inspection", () => {
  it("clears the pin + readout when the pinned cell falls outside the newly selected segment", () => {
    render(<FleetGrid />);
    expect(screen.getByText(/hover a cell to inspect/i)).toBeInTheDocument();

    // Pin a Platform cell.
    fireEvent.click(screen.getByRole("button", { name: /platform-01/ }));
    expect(screen.getByText(/pinned/)).toBeInTheDocument();

    // Filter to a segment that excludes it — the fix drops the stranded pin instead of freezing it.
    fireEvent.click(screen.getByRole("button", { name: "Web" }));
    expect(screen.queryByText(/pinned/)).toBeNull();
    expect(screen.getByText(/hover a cell to inspect/i)).toBeInTheDocument();
  });

  it("keeps the pin when switching to a segment that still contains the pinned cell", () => {
    render(<FleetGrid />);
    fireEvent.click(screen.getByRole("button", { name: /platform-01/ }));
    expect(screen.getByText(/pinned/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Platform" }));
    expect(screen.getByText(/pinned/)).toBeInTheDocument();
  });
});
