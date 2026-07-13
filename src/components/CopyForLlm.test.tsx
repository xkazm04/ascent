// @vitest-environment jsdom
//
// Pins pdf-llm-export #2: CopyForLlm's accessible NAME is a fixed aria-label, so its visible
// Copied / Copy-failed swap was invisible to screen readers. The outcome is now announced through a
// dedicated polite live region (role="status"), which these tests assert for both the success and
// failure paths.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CopyForLlm } from "./CopyForLlm";

afterEach(() => {
  vi.restoreAllMocks();
});

function setClipboard(writeText: ((t: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

describe("CopyForLlm live-region announcement (pdf-llm-export #2)", () => {
  it("starts with an empty polite status region (nothing announced at rest)", () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    render(<CopyForLlm text="hello" />);
    expect(screen.getByRole("status")).toHaveTextContent("");
    // Accessible name is the stable label, which is exactly why the visible swap needed a live region.
    expect(screen.getByRole("button", { name: "Copy for LLM" })).toBeInTheDocument();
  });

  it("announces success in the live region after a successful copy", async () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    render(<CopyForLlm text="hello" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard."));
  });

  it("announces failure when both the clipboard API and the legacy fallback fail", async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error("blocked")));
    // Force the execCommand fallback to fail deterministically.
    (document as unknown as { execCommand: () => boolean }).execCommand = vi.fn(() => false);
    render(<CopyForLlm text="hello" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copy failed."));
  });
});
