// @vitest-environment jsdom
//
// The FIRST DOM test in this repo. Its job is twofold: prove the jsdom opt-in works, and pin the one
// behavior of ConfirmAction that copy tests cannot reach — that the destructive button is never the
// initial focus target. A confirm whose Confirm button is focused is worse than no confirm: the stray
// Enter that would have dismissed a native dialog now fires the irreversible action.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CONTROL_CLASS } from "@/components/ui";
import { ConfirmActionContent } from "./ConfirmAction";

afterEach(() => vi.restoreAllMocks());

function renderContent(overrides: Partial<Parameters<typeof ConfirmActionContent>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmActionContent
      title="Delete the &quot;platform&quot; segment?"
      body="This permanently deletes the segment and removes its 12 repo tags."
      confirmLabel="Delete segment"
      tone="danger"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmActionContent (DOM)", () => {
  it("renders the scope-stating body, not a contentless prompt", () => {
    renderContent();
    expect(screen.getByText(/removes its 12 repo tags/)).toBeInTheDocument();
    expect(screen.queryByText(/are you sure/i)).toBeNull();
  });

  it("lands initial focus on CANCEL, never on the destructive confirm", () => {
    renderContent();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Delete segment" });
    // React does not emit an `autofocus` ATTRIBUTE — it calls .focus() on mount. Assert where focus
    // actually landed, which is the property that matters: a stray Enter must dismiss, not destroy.
    expect(document.activeElement).toBe(cancel);
    expect(document.activeElement).not.toBe(confirm);
  });

  it("disables both buttons while an operation is in flight, so a double-click can't re-fire it", () => {
    renderContent({ busy: true });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    // The confirm swaps to a progress label while busy.
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
  });

  it("skins Cancel with CONTROL_CLASS, not an ad-hoc border-slate-700 outline", () => {
    renderContent();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Delete segment" });
    expect(cancel.className).toContain(CONTROL_CLASS);
    expect(cancel.className).not.toContain("border-slate-700");
    expect(confirm.className).not.toContain("border-slate-700");
    expect(confirm.className).toContain("bg-danger");
  });

  it("keeps the recoverable confirm on the accent fill, still without border-slate-700", () => {
    renderContent({ tone: "default", confirmLabel: "Open draft PR" });
    const confirm = screen.getByRole("button", { name: "Open draft PR" });
    expect(confirm.className).toContain("bg-accent");
    expect(confirm.className).not.toContain("border-slate-700");
    expect(screen.getByRole("button", { name: "Cancel" }).className).toContain(CONTROL_CLASS);
  });

  it("routes clicks to the right handler", async () => {
    const { onConfirm, onCancel } = renderContent();
    screen.getByRole("button", { name: "Cancel" }).click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    screen.getByRole("button", { name: "Delete segment" }).click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
