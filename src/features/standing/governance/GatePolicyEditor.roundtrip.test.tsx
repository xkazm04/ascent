// @vitest-environment jsdom
//
// THE REGRESSION FILE for the bar this form used to delete.
//
// UAT 2026-08-30 (NADIA-L1-07 / PRIYA-L1-01), live: an owner set `requireChecks` — a real,
// gate-enforced control bar, rendered READ-ONLY six rows above this editor — then changed Min overall
// from 50 to 55 and clicked Save. The two required controls were gone. `buildPolicy()` assembled the
// payload field by field and never emitted them; the POST replaces the stored policy wholesale. The
// app's own audit row carried the deleted bar under `previousPolicy` and named it nowhere a human
// reads. Priya: *"it actively undoes the write the next time anyone touches the form."*
//
// The contract these tests hold, and the reason the fix is round-trip rather than a merging POST:
// this form owns exactly the fields it renders. It must replace those (so unchecking a box still
// clears a bar) and hand back every other field BYTE-IDENTICAL. Split from GatePolicyEditor.test.tsx
// for the 200-LOC cap; setup is duplicated deliberately so the file stands alone.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GatePolicyEditor } from "./GatePolicyEditor";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const NO_SWEEP = { status: "skipped", reason: "no-installation", repos: 0, cap: 20 } as const;

function stubSave(body: Record<string, unknown>, ok = true) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const save = () => fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
const sentPolicy = (m: ReturnType<typeof stubSave>) =>
  JSON.parse(String((m.mock.calls[0][1] as RequestInit).body)).policy;

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GatePolicyEditor — fields the form does not render survive a save", () => {
  it("round-trips requireChecks when an unrelated field is edited (the live 50 -> 55 capture)", async () => {
    const stored = {
      minLevel: "L3" as const,
      minOverall: 50,
      minDimension: 40,
      requireChecks: ["control.prepush.lint", "guardrail.never-commit"],
    };
    const fetchMock = stubSave({ policy: { ...stored, minOverall: 55 }, sweep: NO_SWEEP });
    render(<GatePolicyEditor org="acme" initial={stored} />);

    fireEvent.change(screen.getByRole("spinbutton", { name: /Min overall/ }), { target: { value: "55" } });
    save();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const sent = sentPolicy(fetchMock);
    expect(sent.minOverall).toBe(55); // the edit the owner actually made…
    // …and the bar they did not touch, byte-identical.
    expect(sent.requireChecks).toEqual(["control.prepush.lint", "guardrail.never-commit"]);
  });

  it("round-trips the other two unmodelled bars too — the same hole, different fields", async () => {
    const stored = { minOverall: 50, minAiGovernedRate: 100, forbidAiAuthorship: true };
    const fetchMock = stubSave({ policy: stored, sweep: NO_SWEEP });
    render(<GatePolicyEditor org="acme" initial={stored} />);

    save();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const sent = sentPolicy(fetchMock);
    expect(sent.minAiGovernedRate).toBe(100);
    expect(sent.forbidAiAuthorship).toBe(true);
  });

  it("still CLEARS a field it does render — round-trip must not become a merge", async () => {
    // The reason this is fixed in the form and not by merging server-side: a merging POST could never
    // remove a bar, so unchecking this box would silently stop working.
    const stored = { requireProtectedBranch: true, requireChecks: ["control.prepush.lint"] };
    const fetchMock = stubSave({ policy: { requireChecks: ["control.prepush.lint"] }, sweep: NO_SWEEP });
    render(<GatePolicyEditor org="acme" initial={stored} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /protected default branch/i }));
    save();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const sent = sentPolicy(fetchMock);
    expect(sent.requireProtectedBranch).toBeUndefined();
    expect(sent.requireChecks).toEqual(["control.prepush.lint"]); // untouched bar still survives
  });

  it("re-seeds the carried fields from the server echo, so two saves in a row do not resurrect a stale bar", async () => {
    const first = stubSave({ policy: { minOverall: 50 }, sweep: NO_SWEEP });
    render(<GatePolicyEditor org="acme" initial={{ minOverall: 50, requireChecks: ["control.prepush.lint"] }} />);
    save();
    await waitFor(() => expect(first).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("status").textContent).toBeTruthy());

    // The echo said the stored policy no longer carries requireChecks (the API dropped it). The next
    // save must post what is STORED, never the copy the form was seeded with.
    const second = stubSave({ policy: { minOverall: 60 }, sweep: NO_SWEEP });
    fireEvent.change(screen.getByRole("spinbutton", { name: /Min overall/ }), { target: { value: "60" } });
    save();

    await waitFor(() => expect(second).toHaveBeenCalled());
    expect(sentPolicy(second).requireChecks).toBeUndefined();
  });

  it("names a bar the server says the save REMOVED — the check the form's own reconciliation cannot make", async () => {
    // droppedFields() compares the request against the echo, so it is structurally blind to a field
    // the form never sent. The server holds both policies and reports the removal; the owner must see
    // it here rather than by diffing `previousPolicy` in the audit log.
    stubSave({
      policy: { minOverall: 55 },
      dropped: [{ label: "required controls", was: "Reported controls must not be failing: control.prepush.lint" }],
      sweep: NO_SWEEP,
    });
    render(<GatePolicyEditor org="acme" initial={{ minOverall: 55 }} />);

    save();

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("REMOVED"));
    expect(screen.getByRole("status").textContent).toContain("required controls");
    expect(screen.getByRole("status").textContent).toContain("control.prepush.lint");
  });
});
