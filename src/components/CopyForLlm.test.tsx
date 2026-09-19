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
    fireEvent.click(screen.getByRole("button", { name: "Copy for LLM" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copy failed."));
  });
});

// G5-27 — the button must never claim success for a copy that transferred nothing. The clipboard
// mock here RESOLVES (as the real one does for ""), so any regression that drops the emptiness guard
// turns these into "Copied" and fails loudly.
describe("CopyForLlm cannot claim success on an empty payload (G5-27)", () => {
  it.each([
    ["empty string", ""],
    ["whitespace only", "  \n\t "],
  ])("says 'Nothing to copy' for %s and never announces success", async (_label, text) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    render(<CopyForLlm text={text} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy for LLM" }));

    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Nothing to copy"));
    expect(screen.getByRole("button")).not.toHaveTextContent("Copied");
    // The truthful announcement, and no false "Copied to clipboard." for a screen-reader user.
    expect(screen.getByRole("status")).toHaveTextContent("Nothing to copy. This brief is empty.");
    // Nothing was even attempted — no empty write reached the platform clipboard, so a previously
    // copied payload is left intact rather than being wiped by an empty write.
    expect(writeText).not.toHaveBeenCalled();
  });

  it("does not fire onCopied when there was nothing to copy", async () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    const onCopied = vi.fn();
    render(<CopyForLlm text="" onCopied={onCopied} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy for LLM" }));
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Nothing to copy"));
    expect(onCopied).not.toHaveBeenCalled(); // a "use" must not be counted for a no-op
  });

  it("a non-empty payload still reports success normally", async () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    render(<CopyForLlm text="# brief" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy for LLM" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard."));
  });
});

describe("CopyForLlm manual-copy fallback (pdf-llm-export #4)", () => {
  function forceBothPathsToFail() {
    setClipboard(vi.fn().mockRejectedValue(new Error("blocked")));
    (document as unknown as { execCommand: () => boolean }).execCommand = vi.fn(() => false);
  }

  it("opens a readonly textarea holding the full payload when both copy paths fail", async () => {
    forceBothPathsToFail();
    render(<CopyForLlm text="# briefing payload" />);
    // No fallback surface at rest — failure is what reveals it.
    expect(screen.queryByLabelText("Markdown briefing to copy manually")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy for LLM" }));
    const ta = await screen.findByLabelText<HTMLTextAreaElement>("Markdown briefing to copy manually");
    expect(ta).toHaveValue("# briefing payload");
    expect(ta).toHaveAttribute("readonly");
  });

  it("fallback persists past the 2.5s failed flash and closes via its Close button", async () => {
    forceBothPathsToFail();
    render(<CopyForLlm text="payload" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy for LLM" }));
    await screen.findByLabelText("Markdown briefing to copy manually");

    // The failed BUTTON state auto-resets, but the recovery surface must not vanish with it.
    await waitFor(
      () => expect(screen.getByRole("button", { name: "Copy for LLM" })).toHaveTextContent("Copy for LLM"),
      { timeout: 4000 },
    );
    expect(screen.getByLabelText("Markdown briefing to copy manually")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close manual copy panel" }));
    expect(screen.queryByLabelText("Markdown briefing to copy manually")).not.toBeInTheDocument();
  });

  it("empty payload: no fallback textarea either — an empty box to Ctrl+C is a dead end", async () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    render(<CopyForLlm text="   " />);
    fireEvent.click(screen.getByRole("button", { name: "Copy for LLM" }));
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Nothing to copy"));
    expect(screen.queryByLabelText("Markdown briefing to copy manually")).not.toBeInTheDocument();
  });

  it("a later successful copy closes the fallback surface", async () => {
    forceBothPathsToFail();
    render(<CopyForLlm text="payload" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy for LLM" }));
    await screen.findByLabelText("Markdown briefing to copy manually");

    setClipboard(vi.fn().mockResolvedValue(undefined)); // clipboard becomes available again
    fireEvent.click(screen.getByRole("button", { name: "Copy for LLM" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Markdown briefing to copy manually")).not.toBeInTheDocument(),
    );
  });
});
