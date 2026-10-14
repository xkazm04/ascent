// @vitest-environment jsdom
// The copy ladder (agent-pasteable-reference-format): every rung reports itself, a throwing legacy
// copy cannot leak its temporary field, and the last rung hands the operator SELECTED text.

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./devCopy";
import { InspectorHud } from "./devInspectorUi";

const setClipboard = (writeText?: (t: string) => Promise<void>) =>
  Object.defineProperty(navigator, "clipboard", { value: writeText ? { writeText } : undefined, configurable: true });

afterEach(() => vi.restoreAllMocks());

describe("copyText ladder", () => {
  it("names the async rung on the good path", async () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    expect(await copyText("src/a.tsx:1")).toBe("async");
  });

  it("falls to the legacy rung when the async write rejects", async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    document.execCommand = vi.fn().mockReturnValue(true);
    expect(await copyText("src/a.tsx:1")).toBe("legacy");
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("reports failed - never success - when both rungs refuse", async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn().mockReturnValue(false);
    expect(await copyText("src/a.tsx:1")).toBe("failed");
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("removes the temporary field even when the legacy command throws", async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn(() => {
      throw new Error("blocked");
    });
    expect(await copyText("src/a.tsx:1")).toBe("failed");
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });
});

describe("HUD manual rung", () => {
  const hud = (copyOk: boolean) =>
    render(
      <InspectorHud
        copied="src/a.tsx:1"
        copyOk={copyOk}
        mappingOn
        crumbs={[]}
        unstamped={false}
        defaultLoc={null}
        selectedIndex={0}
        onCopy={() => {}}
      />,
    );

  it("shows the reference as selected text when the copy failed", () => {
    hud(false);
    const field = screen.getByLabelText(/Ctrl\+C/) as HTMLTextAreaElement;
    expect(field.value).toBe("src/a.tsx:1");
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    expect(screen.getByText("Copy failed")).toBeTruthy();
  });

  it("keeps the plain confirmation on success", () => {
    hud(true);
    expect(screen.queryByLabelText(/Ctrl\+C/)).toBeNull();
    expect(screen.getByText("Copied ✓")).toBeTruthy();
  });
});
