// @vitest-environment jsdom
// Idle used to return null, so the overlay was invisible until `;` then `i`
// within two seconds. With DEV_INSPECT stamps present, a corner chip must
// advertise the tool and one-click arm it; Esc returns to that chip.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DevInspector } from "./DevInspector";

describe("DevInspector idle chip", () => {
  it("shows the Inspect chip at idle when mapping stamps exist, and click arms the HUD", async () => {
    render(
      <>
        <div data-loc="src/app/page.tsx:10:1">stamped</div>
        <DevInspector />
      </>,
    );

    const chip = await screen.findByRole("button", { name: /Inspect/i });
    expect(chip.textContent).toMatch(/Inspect\s+`; i`/);
    expect(chip.style.pointerEvents).toBe("auto");
    expect(chip.style.right).toBe("12px");
    expect(chip.style.bottom).toBe("12px");
    expect(screen.queryByText("⌖ DevInspector")).toBeNull();

    fireEvent.click(chip);

    expect(screen.getByText("⌖ DevInspector")).toBeTruthy();
    expect(screen.getByText(/Hover a component/)).toBeTruthy();
    // Chip stays bottom-right once armed so the HUD does not replace it with nothing.
    expect(screen.getByRole("button", { name: /Inspect/i }).style.right).toBe("12px");
  });

  it("shows mapping-off copy when no data-loc exists", async () => {
    render(<DevInspector />);
    const chip = await screen.findByRole("status");
    expect(chip.textContent).toMatch(/mapping off → npm run dev:inspect/);
    expect(chip.style.pointerEvents).toBe("auto");
  });

  it("Esc from armed returns to the chip, not to nothing", async () => {
    render(
      <>
        <div data-loc="src/app/page.tsx:10:1">stamped</div>
        <DevInspector />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Inspect/i }));
    expect(screen.getByText("⌖ DevInspector")).toBeTruthy();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(screen.queryByText("⌖ DevInspector")).toBeNull();
    expect(screen.getByRole("button", { name: /Inspect/i })).toBeTruthy();
  });
});
