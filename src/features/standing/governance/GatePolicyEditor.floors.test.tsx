// @vitest-environment jsdom
//
// Per-dimension floors beyond D9 — split out of GatePolicyEditor.test.tsx so every test file stays
// under the 200-LOC cap (AGENTS.md). GatePolicy has always supported floors on D1..D9 and the gate
// enforces every one, but the editor exposed only D9 — so "no repo below 50 on Testing" was reachable
// only by POSTing raw JSON at the API. These tests hold the generic dimension-floor rows to the same
// contract the rest of the editor is held to: seeded from the STORED policy, added/removed without
// clobbering the dedicated D9 control, and named individually when the server sheds one.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GatePolicyEditor } from "./GatePolicyEditor";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** Stub the POST with a canned `{ policy, sweep }` echo — the two things the UI is driven by. */
function stubSave(body: Record<string, unknown>, ok = true) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const save = () => fireEvent.click(screen.getByRole("button", { name: "Save policy" }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// GatePolicy has always supported floors on D1..D9 and the gate enforces every one, but the editor
// exposed only D9 — so "no repo below 50 on Testing" was reachable only by POSTing raw JSON at the API.
describe("GatePolicyEditor — per-dimension floors beyond D9", () => {
  it("seeds configured non-D9 floors from the stored policy", () => {
    render(<GatePolicyEditor org="acme" initial={{ minDimensionFor: { D2: 45, D9: 70 } }} />);

    expect((screen.getByRole("spinbutton", { name: /^D2 .* minimum score$/ }) as HTMLInputElement).value).toBe("45");
    // D9 stays on its own dedicated control, never duplicated into the generic list.
    expect(screen.queryByRole("spinbutton", { name: /^D9 .* minimum score$/ })).toBeNull();
    expect((screen.getByRole("spinbutton", { name: /Security floor/ }) as HTMLInputElement).value).toBe("70");
  });

  it("adds a floor from the dimension picker and sends it alongside the D9 floor", async () => {
    const fetchMock = stubSave({ policy: { minDimensionFor: { D2: 50, D9: 70 } }, sweep: { status: "skipped", reason: "no-installation", repos: 0, cap: 20 } });
    render(<GatePolicyEditor org="acme" initial={{ minDimensionFor: { D9: 70 } }} />);

    fireEvent.change(screen.getByRole("combobox", { name: /Add a floor/ }), { target: { value: "D2" } });
    save();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    // Both survive: adding a dimension floor must not clobber the configured Security floor.
    expect(sent.policy.minDimensionFor).toEqual({ D2: 50, D9: 70 });
  });

  it("removes a floor without touching the others", async () => {
    const fetchMock = stubSave({ policy: { minDimensionFor: { D9: 70 } }, sweep: { status: "skipped", reason: "no-installation", repos: 0, cap: 20 } });
    render(<GatePolicyEditor org="acme" initial={{ minDimensionFor: { D2: 45, D9: 70 } }} />);

    fireEvent.click(screen.getByRole("button", { name: /Remove the D2 .* floor/ }));
    save();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(sent.policy.minDimensionFor).toEqual({ D9: 70 });
  });

  it("names the specific dimension when the server sheds an out-of-range floor", async () => {
    // The sanitizer drops <=0 / >100 floors as "not set", so the form must say WHICH row was shed.
    stubSave({ policy: { minDimensionFor: { D9: 70 } }, sweep: { status: "skipped", reason: "no-installation", repos: 0, cap: 20 } });
    render(<GatePolicyEditor org="acme" initial={{ minDimensionFor: { D2: 45, D9: 70 } }} />);

    save();

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Saved, but NOT enforced"));
    expect(screen.getByRole("status").textContent).toContain("D2 floor");
    // …and the form re-seeds from the echo, so the shed row is gone.
    expect(screen.queryByRole("spinbutton", { name: /^D2 .* minimum score$/ })).toBeNull();
  });
});
