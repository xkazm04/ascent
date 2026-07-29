// @vitest-environment jsdom
//
// First tests for the gate-policy editor — the form that moves an org's MERGE-BLOCKING bar, and
// which had no coverage at all despite two non-trivial pure reconciliations:
//
//  1. droppedFields()/syncForm — sanitizeGatePolicy silently discards ≤0 / out-of-range floors, so a
//     save can succeed while shedding fields the form still shows as enabled. The editor must name
//     exactly what was dropped and re-seed itself from what is TRULY stored (never from what was
//     merely requested), or the owner is told the gate enforces a bar that was never persisted.
//  2. appliesWhen() — the new "when does this take effect" copy. It must be driven by the server's
//     sweep plan and stay honest in BOTH installation states: never promise an open-PR re-check the
//     App cannot perform.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GatePolicyEditor, appliesWhen } from "./GatePolicyEditor";

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

describe("appliesWhen — when the new bar actually takes effect", () => {
  it("promises the open-PR re-check ONLY when the server actually scheduled one, and states the cap", () => {
    const text = appliesWhen({ status: "scheduled", repos: 3, cap: 20 });
    expect(text).toContain("Open PRs re-check within a minute");
    expect(text).toContain("up to 20");
    expect(text).toContain("3 watched repos");
    // The bound must be stated, not implied — anything past the cap waits for a push.
    expect(text).toContain("next push");
  });

  it("singularizes a one-repo fleet", () => {
    expect(appliesWhen({ status: "scheduled", repos: 1, cap: 20 })).toContain("1 watched repo.");
  });

  it("says plainly that NOTHING was re-checked when the org has no App installation", () => {
    const text = appliesWhen({ status: "skipped", reason: "no-installation", repos: 0, cap: 20 }) ?? "";
    expect(text).toContain("No GitHub App installation");
    expect(text).toContain("not re-checked");
    // It must never claim the re-check it cannot do.
    expect(text).not.toContain("re-check within a minute");
  });

  it("distinguishes the no-watched-repos case from the no-installation case", () => {
    const text = appliesWhen({ status: "skipped", reason: "no-watched-repos", repos: 0, cap: 20 }) ?? "";
    expect(text).toContain("No watched repos");
    expect(text).not.toContain("re-check within a minute");
  });

  it("says nothing at all when the response carries no sweep plan (never guesses)", () => {
    expect(appliesWhen(undefined)).toBeNull();
  });
});

describe("GatePolicyEditor — the stored policy is the source of truth", () => {
  it("round-trips a partially-dropped save: names the shed fields and re-seeds the form from the echo", async () => {
    // Requested: min overall 40 + a D9 floor of 70. The server stores only the overall — the floor
    // was shed by the sanitizer. The old null-vs-non-null echo check couldn't see this.
    stubSave({ policy: { minOverall: 40 }, sweep: { status: "scheduled", repos: 1, cap: 20 } });
    render(<GatePolicyEditor org="acme" initial={{ minOverall: 40, minDimensionFor: { D9: 70 } }} />);

    expect((screen.getByRole("spinbutton", { name: /Security floor/ }) as HTMLInputElement).value).toBe("70");
    save();

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Saved, but NOT enforced"));
    expect(screen.getByRole("status").textContent).toContain("security floor (D9)");
    // Re-seeded from the ECHO: the checkbox is off and the floor is back to the 50 default, because
    // that is what is actually stored — not the 70 the owner asked for.
    expect((screen.getByRole("checkbox", { name: /Security floor/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("spinbutton", { name: /Security floor/ }) as HTMLInputElement).value).toBe("50");
  });

  it("reports a clean save without a dropped-field warning, and preserves a custom D9 floor", async () => {
    const fetchMock = stubSave({
      policy: { minLevel: "L3", minDimensionFor: { D9: 70 }, forbidPostures: ["ungoverned"] },
      sweep: { status: "scheduled", repos: 2, cap: 20 },
    });
    render(
      <GatePolicyEditor org="acme" initial={{ minLevel: "L3", minDimensionFor: { D9: 70 }, forbidPostures: ["ungoverned"] }} />,
    );
    save();

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Policy saved"));
    expect(screen.getByRole("status").textContent).not.toContain("NOT enforced");
    // ci-gate-status-checks #2: the checkbox is a lossy boolean projection — the request must carry
    // the configured 70, never a hardcoded 50.
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1] && (fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(sent.policy.minDimensionFor).toEqual({ D9: 70 });
  });

  it("treats an all-dropped policy (echo null) as the reset it really is", async () => {
    stubSave({ policy: null, sweep: { status: "skipped", reason: "no-installation", repos: 0, cap: 20 } });
    render(<GatePolicyEditor org="acme" initial={{ minLevel: "L4" }} />);
    save();

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Reset to the archetype default"));
  });
});

describe("GatePolicyEditor — stating when the bar applies", () => {
  it("renders the scheduled-sweep copy from the response after a save", async () => {
    stubSave({ policy: { minLevel: "L3" }, sweep: { status: "scheduled", repos: 4, cap: 20 } });
    render(<GatePolicyEditor org="acme" initial={{ minLevel: "L3" }} />);
    save();

    await waitFor(() => expect(screen.getByText(/Open PRs re-check within a minute/)).toBeTruthy());
    expect(screen.getByText(/4 watched repos/)).toBeTruthy();
  });

  it("renders the honest no-installation copy instead — never the re-check promise", async () => {
    stubSave({ policy: { minLevel: "L3" }, sweep: { status: "skipped", reason: "no-installation", repos: 0, cap: 20 } });
    render(<GatePolicyEditor org="acme" initial={{ minLevel: "L3" }} />);
    save();

    await waitFor(() => expect(screen.getByText(/No GitHub App installation/)).toBeTruthy());
    expect(screen.queryByText(/re-check within a minute/)).toBeNull();
  });

  it("shows no applies-when claim at all when the save FAILED", async () => {
    stubSave({ error: "nope" }, false);
    render(<GatePolicyEditor org="acme" initial={null} />);
    save();

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Error:"));
    expect(screen.queryByText(/applies|re-check/)).toBeNull();
  });
});
