// @vitest-environment jsdom
//
// repositories-segments #5: the per-segment cadence dropdown must REVERT to its prior value when the
// server rejects the change (403 / validation / network) — otherwise it keeps displaying a cadence the
// server never accepted (phantom state).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { SegmentActions } from "./SegmentActions";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
beforeEach(() => vi.clearAllMocks());

const cadenceSelect = () =>
  screen.getByLabelText("Set autoscan cadence for this segment") as HTMLSelectElement;

// repositories-segments 2026-07-16 #2: the scan button must state the WATCHED scope the server will
// actually scan (POST /api/org/scan intersects with the watch list), never the full tagged count.
describe("SegmentActions scan-scope honesty (#2)", () => {
  it("labels the button '<watched> of <tagged> watched' when only a subset is watched", () => {
    render(<SegmentActions org="acme" segmentId="seg1" repos={["acme/web", "acme/api"]} taggedCount={5} />);
    expect(screen.getByRole("button", { name: "Scan segment (2 of 5 watched)" })).toBeEnabled();
  });

  it("keeps the plain count when every tagged repo is watched", () => {
    render(<SegmentActions org="acme" segmentId="seg1" repos={["acme/web", "acme/api"]} taggedCount={2} />);
    expect(screen.getByRole("button", { name: "Scan segment (2)" })).toBeEnabled();
  });

  it("disables with an explanatory title when tagged repos exist but none are watched", () => {
    render(<SegmentActions org="acme" segmentId="seg1" repos={[]} taggedCount={4} />);
    const btn = screen.getByRole("button", { name: "Scan segment (0 of 4 watched)" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringMatching(/none of this segment's 4 tagged/i));
  });
});

describe("SegmentActions cadence dropdown (#5)", () => {
  it("reverts to the prior value when the server rejects the cadence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Admins only." }) }),
    );
    render(<SegmentActions org="acme" segmentId="seg1" repos={["acme/web"]} />);
    const select = cadenceSelect();
    expect(select.value).toBe(""); // "Cadence…" placeholder

    fireEvent.change(select, { target: { value: "daily" } });

    // The rejected cadence must not stick — it rolls back to the placeholder and surfaces the reason.
    await waitFor(() => expect(select.value).toBe(""));
    expect(screen.getByText("Admins only.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled(); // no refresh on a failed write
  });

  it("keeps the new value and refreshes when the server accepts it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ updated: 3 }) }),
    );
    render(<SegmentActions org="acme" segmentId="seg1" repos={["acme/web"]} />);
    const select = cadenceSelect();

    fireEvent.change(select, { target: { value: "weekly" } });

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(select.value).toBe("weekly"); // accepted → the selection is retained
  });
});
