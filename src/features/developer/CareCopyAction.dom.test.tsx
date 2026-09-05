// @vitest-environment jsdom
// The Developer page discloses that its Care actions are unwired — they `console.info` their intent.
// "Copy <command>" is the one that cannot be, because the label is a promise about the clipboard.
// This pins that promise: the click writes the EXACT command, the button says so, and where the
// Clipboard API does not exist the button is not offered at all and the command stays selectable.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CareCopyAction } from "./CareCopyAction";

const CMD = "npx ascent mentor init";

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true, writable: true });
}

afterEach(() => {
  setClipboard(undefined);
  vi.restoreAllMocks();
});

describe("CareCopyAction", () => {
  it("copies the exact command and reports it", async () => {
    const writeText = vi.fn(async () => {});
    setClipboard({ writeText });
    render(<CareCopyAction command={CMD} />);

    const button = await screen.findByRole("button", { name: /copy/i });
    fireEvent.click(button);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(CMD);
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("Copied"));
  });

  it("renders the command as selectable text beside the button", async () => {
    setClipboard({ writeText: vi.fn(async () => {}) });
    const { container } = render(<CareCopyAction command={CMD} />);

    const code = container.querySelector("code");
    expect(code?.textContent).toBe(CMD);
    // `select-all` is what makes a triple-click take the whole command and nothing else.
    expect(code?.className).toContain("select-all");
    expect(await screen.findByRole("button", { name: /copy/i })).toBeTruthy();
  });

  it("offers no copy button when the Clipboard API is unavailable — the command stays takeable", async () => {
    setClipboard(undefined);
    const { container } = render(<CareCopyAction command={CMD} />);

    await waitFor(() => expect(screen.getByText(/select to copy/i)).toBeTruthy());
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("code")?.textContent).toBe(CMD);
  });

  it("falls back to the selectable text when writeText rejects (insecure context)", async () => {
    setClipboard({
      writeText: vi.fn(async () => {
        throw new Error("denied");
      }),
    });
    render(<CareCopyAction command={CMD} />);

    fireEvent.click(await screen.findByRole("button", { name: /copy/i }));

    await waitFor(() => expect(screen.getByText(/select to copy/i)).toBeTruthy());
    // No false "Copied": the button never claims a transfer that did not happen.
    expect(screen.queryByText("Copied")).toBeNull();
  });
});
