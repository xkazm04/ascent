// @vitest-environment jsdom
//
// RE-PAIR A MOVED CHECKOUT FROM THE BATCH LEDGER (challenge-2026-09-23b, local-autopilot-loop-engine#B).
// Re-pairing used to exist only on Admin → Pairing, one row at a time; the cockpit that discovered the
// broken pairing had no path to it. Pinned here, over a fetch stub: an owner's Re-pair posts the SAME
// owner-gated pairing route the admin tab uses, a success hands control back (the ledger refetches), a
// refusal is shown inline with the typed path kept, and a non-owner is told the sentence and nothing
// they cannot act on.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchRepairPairing } from "./BatchRepairPairing";

const MOVED = "Folder does not exist on the server's filesystem.";
let posts: { url: string; body: Record<string, unknown> }[] = [];
let refusal: string | null = null;

beforeEach(() => {
  posts = [];
  refusal = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      if (refusal) return { ok: false, status: 422, json: async () => ({ ok: false, error: refusal }) } as Response;
      return { ok: true, status: 200, json: async () => ({ ok: true, paired: true }) } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (canRepair: boolean, onRepaired = vi.fn()) => {
  render(<BatchRepairPairing slug="acme" repo="acme/web" error={MOVED} canRepair={canRepair} onRepaired={onRepaired} />);
  return onRepaired;
};

async function repair(path: string) {
  fireEvent.change(screen.getByRole("textbox", { name: /new path for acme\/web/i }), { target: { value: path } });
  await act(async () => void fireEvent.click(screen.getByRole("button", { name: /re-pair/i })));
}

describe("BatchRepairPairing", () => {
  it("as owner: Re-pair posts {org, fullName, path} to the pairing route and hands back on success", async () => {
    const onRepaired = mount(true);
    expect(screen.getByText(MOVED, { exact: false })).toBeTruthy();
    await repair("/srv/code/web");
    expect(posts).toEqual([{ url: "/api/org/local/pairing", body: { org: "acme", fullName: "acme/web", path: "/srv/code/web" } }]);
    expect(onRepaired).toHaveBeenCalledTimes(1);
  });

  it("as owner: a 422 renders the verifier's error inline and keeps the typed path", async () => {
    refusal = "Not a git repository (or git is not installed on the server).";
    const onRepaired = mount(true);
    await repair("/srv/code/elsewhere");
    expect(screen.getByRole("alert").textContent).toContain(refusal);
    expect((screen.getByRole("textbox", { name: /new path for acme\/web/i }) as HTMLInputElement).value).toBe("/srv/code/elsewhere");
    expect(onRepaired).not.toHaveBeenCalled();
  });

  it("as a non-owner: the sentence only, no input and no button", () => {
    mount(false);
    expect(screen.getByText(MOVED, { exact: false })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
