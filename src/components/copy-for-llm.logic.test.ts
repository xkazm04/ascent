// Pins the DOM-free core of CopyForLlm: the clipboard-with-fallback decision (attemptCopy) and the
// copied/failed state machine (nextCopyState). Runs under the project's node (no-jsdom) Vitest env by
// injecting the clipboard API + a fake legacy copy fn — no real DOM, no React render.

import { describe, it, expect, vi } from "vitest";
import {
  attemptCopy,
  isCopyableText,
  nextCopyState,
  COPIED_RESET_MS,
  FAILED_RESET_MS,
} from "./copy-for-llm.logic";

describe("attemptCopy (clipboard + legacy fallback)", () => {
  it("uses the Clipboard API when present and resolving; never touches legacy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const legacy = vi.fn().mockReturnValue(false);

    const ok = await attemptCopy("payload", { writeText }, legacy);

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("payload");
    expect(legacy).not.toHaveBeenCalled();
  });

  it("falls back to legacy when writeText rejects, returning legacy's result", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("not allowed"));
    const legacy = vi.fn().mockReturnValue(true);

    const ok = await attemptCopy("payload", { writeText }, legacy);

    expect(ok).toBe(true); // legacy succeeded
    expect(writeText).toHaveBeenCalledWith("payload");
    expect(legacy).toHaveBeenCalledWith("payload");
  });

  it("falls back to legacy when the clipboard API is absent (insecure context)", async () => {
    const legacy = vi.fn().mockReturnValue(true);

    const ok = await attemptCopy("payload", undefined, legacy);

    expect(ok).toBe(true);
    expect(legacy).toHaveBeenCalledWith("payload");
  });

  it("falls back to legacy when clipboard exists but has no writeText", async () => {
    const legacy = vi.fn().mockReturnValue(true);

    const ok = await attemptCopy("payload", {}, legacy);

    expect(ok).toBe(true);
    expect(legacy).toHaveBeenCalledWith("payload");
  });

  it("returns false when both the Clipboard API and the legacy fallback fail", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("blocked"));
    const legacy = vi.fn().mockReturnValue(false);

    const ok = await attemptCopy("payload", { writeText }, legacy);

    expect(ok).toBe(false);
    expect(legacy).toHaveBeenCalledWith("payload");
  });

  it("returns false when the API is absent and the legacy fallback also fails", async () => {
    const legacy = vi.fn().mockReturnValue(false);

    const ok = await attemptCopy("payload", undefined, legacy);

    expect(ok).toBe(false);
  });
});

// G5-27: `navigator.clipboard.writeText("")` RESOLVES, so an empty payload used to come back as a
// success and the button flipped to "Copied" having transferred nothing. The refusal lives in the
// shared primitive (not at one call site) so no caller can reintroduce a false success.
describe("attemptCopy refuses an empty payload (G5-27)", () => {
  it.each([
    ["empty string", ""],
    ["spaces", "   "],
    ["newlines + tabs", "\n\t \r\n"],
  ])("returns false for %s without touching EITHER copy path", async (_label, text) => {
    const writeText = vi.fn().mockResolvedValue(undefined); // would have "succeeded"
    const legacy = vi.fn().mockReturnValue(true); // as would this

    const ok = await attemptCopy(text, { writeText }, legacy);

    expect(ok).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it("still copies a payload that is merely small", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await attemptCopy("x", { writeText }, () => false)).toBe(true);
    expect(writeText).toHaveBeenCalledWith("x");
  });

  it("isCopyableText is the single definition of 'nothing to copy'", () => {
    expect(isCopyableText("")).toBe(false);
    expect(isCopyableText("  \n ")).toBe(false);
    expect(isCopyableText("# brief")).toBe(true);
    expect(isCopyableText(" 0 ")).toBe(true); // whitespace-padded content is still content
  });
});

describe("nextCopyState (copied/failed state machine)", () => {
  it("idle -> copied (with COPIED_RESET_MS) on success", () => {
    expect(nextCopyState(true)).toEqual({ next: "copied", resetMs: COPIED_RESET_MS });
  });

  it("idle -> failed (with FAILED_RESET_MS) on failure", () => {
    expect(nextCopyState(false)).toEqual({ next: "failed", resetMs: FAILED_RESET_MS });
  });

  it("both terminal states auto-reset back to idle (positive delays)", () => {
    expect(COPIED_RESET_MS).toBeGreaterThan(0);
    expect(FAILED_RESET_MS).toBeGreaterThan(0);
  });
});
