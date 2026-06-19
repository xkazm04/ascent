// Pins the DOM-free core of CopyForLlm: the clipboard-with-fallback decision (attemptCopy) and the
// copied/failed state machine (nextCopyState). Runs under the project's node (no-jsdom) Vitest env by
// injecting the clipboard API + a fake legacy copy fn — no real DOM, no React render.

import { describe, it, expect, vi } from "vitest";
import {
  attemptCopy,
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
