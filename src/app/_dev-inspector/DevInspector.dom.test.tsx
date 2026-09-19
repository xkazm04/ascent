// @vitest-environment jsdom
// Idle used to return null, so the overlay was invisible until `;` then `i`
// within two seconds. With DEV_INSPECT stamps present, a corner chip must
// advertise the tool and one-click arm it; Esc returns to that chip.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("still arms with ; then i", async () => {
    render(
      <>
        <div data-loc="src/app/page.tsx:10:1">stamped</div>
        <DevInspector />
      </>,
    );
    await screen.findByRole("button", { name: /Inspect/i });
    press(";");
    expect(screen.getByText(/keyboard mode/)).toBeTruthy();
    press("i");
    expect(screen.getByText("⌖ DevInspector")).toBeTruthy();
  });
});

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function setClipboard(writeText: (t: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

function tree() {
  return (
    <>
      <div data-loc="src/app/page.tsx:20:1">
        <div data-loc="src/components/landing/Section.tsx:4:1">
          <span data-loc="src/components/landing/Hero.tsx:8:1">hero</span>
        </div>
      </div>
      <DevInspector />
    </>
  );
}

describe("DevInspector armed keyboard copy", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });

  async function armAndHover(writeText: (t: string) => Promise<void>) {
    setClipboard(writeText);
    render(tree());
    fireEvent.click(await screen.findByRole("button", { name: /Inspect/i }));
    fireEvent.mouseMove(screen.getByText("hero"));
    // Unique vs the HUD `path:line` button, which shares the default loc's aria-label.
    expect(
      screen.getByRole("button", { current: true, name: "Copy src/components/landing/Hero.tsx:8" }),
    ).toBeTruthy();
  }

  it("Enter copies the default loc", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await armAndHover(writeText);
    press("Enter");
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("src/components/landing/Hero.tsx:8"));
  });

  it("c copies the default loc", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await armAndHover(writeText);
    press("c");
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("src/components/landing/Hero.tsx:8"));
  });

  it("arrow keys move crumb selection then Enter copies that loc", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await armAndHover(writeText);
    press("ArrowDown");
    expect(writeText).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { current: true, name: "Copy src/components/landing/Section.tsx:4" }),
    ).toBeTruthy();
    press("Enter");
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith("src/components/landing/Section.tsx:4");
  });
});
