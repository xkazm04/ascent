// @vitest-environment jsdom
// The reconcile surface: silent with no measured rows, discloses the scan count before it runs, and
// runs through the existing import client (runImportScan) as a one-shot, unwatched scan.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const { mockRun, mockRefresh } = vi.hoisted(() => ({ mockRun: vi.fn(), mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/components/onboarding/importScan", () => ({ runImportScan: mockRun }));

import { AttributionReconcile } from "./AttributionReconcile";
import type { AttributionWire } from "./attributionReconcileModel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const wire = (over: Partial<AttributionWire> = {}): AttributionWire => ({
  windowTitle: "Last 90 days",
  measured: [
    { repo: "acme/x", costCents: 4000 },
    { repo: "acme/y", costCents: 1000 },
  ],
  deliverySet: ["acme/x"],
  fleet: ["acme/x"],
  gitlabConnected: false,
  ...over,
});

describe("AttributionReconcile", () => {
  it("renders nothing when no measured repo rows exist", () => {
    const { container } = render(<AttributionReconcile slug="acme" attribution={wire({ measured: [] })} />);
    expect(container.textContent).toBe("");
    expect(container.textContent).not.toContain("$0");
  });

  it("names the hidden spend and discloses the scan before it runs", async () => {
    mockRun.mockResolvedValue({ ok: true });
    const { container } = render(<AttributionReconcile slug="acme" attribution={wire()} />);
    expect(container.textContent).toContain("$10.00 of $50.00 measured spend (20%)");
    expect(container.textContent).toContain("1 in all");
    expect(container.textContent).not.toContain(String.fromCharCode(0x2014));
    expect(mockRun).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scan 1 repository" }));
    });
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun.mock.calls[0]![0]).toMatchObject({ org: "acme", repos: ["acme/y"], watch: false, schedule: "off" });
    expect(mockRefresh).toHaveBeenCalled();
  });
});
