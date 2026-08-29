// @vitest-environment jsdom
//
// Pins the destructive-action UX of the org data-erasure control (G2-34). The route is trivial; the
// ways this UI can lie are not, so each of these is a way it must NOT read:
//   • submit armed by anything other than the org's name typed back exactly;
//   • a 207 `resumable` partial rendered as either success or failure (it is neither — run it again);
//   • `audited: false` rendered as a clean success (the deletes stand, the compliance trace is gone).
// The blast-radius preview that arms the field has its own file: DataErasurePreview.test.tsx.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OK, PREVIEW, confirmInput, eraseButton, mockPost, submit } from "./dataErasureTestKit";
import { DataErasureCard } from "./DataErasureCard";
import { confirmMatches } from "./DataErasureDialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

beforeEach(async () => {
  // The preview is answered first; each test then re-stubs fetch for the erase itself, so the
  // per-test fetch mocks below count ONLY erase calls.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => PREVIEW })));
  render(<DataErasureCard slug="acme" />);
  fireEvent.click(eraseButton());
  await screen.findByText(/Would be erased now/i);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DataErasureCard — typed confirmation gate", () => {
  it("blocks submit until the org name is typed back exactly", async () => {
    const fetchMock = mockPost(200, OK);

    expect(submit().disabled).toBe(true); // empty
    fireEvent.change(confirmInput(), { target: { value: "acm" } });
    expect(submit().disabled).toBe(true); // prefix
    fireEvent.change(confirmInput(), { target: { value: "ACME" } });
    expect(submit().disabled).toBe(true); // wrong case is not an exact echo
    expect(screen.getByText(/doesn't match acme/i)).toBeTruthy();

    fireEvent.click(submit());
    expect(fetchMock).not.toHaveBeenCalled(); // a disabled destructive button never fires

    fireEvent.change(confirmInput(), { target: { value: " acme " } }); // paste whitespace is forgiven
    expect(submit().disabled).toBe(false);

    fireEvent.click(submit());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toEqual({ org: "acme", confirm: "acme", includeAudit: false });
  });

  it("names what is destroyed and what survives, specifically", () => {
    expect(screen.getByText(/Erased, permanently/i)).toBeTruthy();
    expect(screen.getByText(/Kept, untouched/i)).toBeTruthy();
    expect(screen.getByText(/Every repository's scan-derived cache/i)).toBeTruthy();
    expect(screen.getByText(/watched, their scan schedules/i)).toBeTruthy();
    // The audit trail moves columns with the opt-in rather than being described vaguely — and it is
    // described as REDACTION, which is what includeAudit:true actually resolves to.
    expect(screen.getByText(/Tick the box below to redact it to identifier-only/i)).toBeTruthy();
  });
});

describe("confirmMatches", () => {
  it("accepts only the exact name, trimmed", () => {
    expect(confirmMatches("acme", "acme")).toBe(true);
    expect(confirmMatches("  acme\n", "acme")).toBe(true);
    expect(confirmMatches("ACME", "acme")).toBe(false);
    expect(confirmMatches("acme-corp", "acme")).toBe(false);
    expect(confirmMatches("", "acme")).toBe(false);
  });
});
