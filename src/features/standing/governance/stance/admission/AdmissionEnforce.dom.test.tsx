// @vitest-environment jsdom
//
// The Enforce panel (moonshot #8 follow-up "proposal dry-run modal UI", MC-X3). The column said the
// CODEOWNERS block and the branch ruleset "are proposals a person opens deliberately" and nothing on
// screen could open them. These pin the HITL order: a preview is a zero-write call, the write is a
// second, deliberate click carrying the digest of what was shown, and an applied ruleset is
// revertable from the row that applied it.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AdmissionView } from "./admissionRows";
import { artifactFingerprint } from "@/lib/practices/fingerprint";

const { AdmissionEnforce } = await import("./AdmissionEnforce");
const { AdmissionRow } = await import("./AdmissionRow");

const VIEW: AdmissionView = {
  fullName: "xkazm04/kp",
  name: "kp",
  mode: "assisted-only",
  tier: "T1",
  decided: true,
  decidedBy: "priya",
  overridesDerived: null,
  stale: false,
  rulesetId: null,
  unassessed: false,
};

const DIFF = "--- a/CODEOWNERS\n+++ b/CODEOWNERS\n+# BEGIN ascent:ai-stance v4\n+/billing/ @acme/platform";

type Call = { url: string; method: string; body: Record<string, unknown> };
let calls: Call[] = [];

function serve(handler: (c: Call) => { status?: number; body: unknown }) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const c: Call = { url, method: init?.method ?? "GET", body: JSON.parse(String(init?.body ?? "{}")) };
      calls.push(c);
      const r = handler(c);
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
    }),
  );
}

beforeEach(() => vi.unstubAllGlobals());

describe("AdmissionEnforce — CODEOWNERS", () => {
  it("previews with confirm:false, renders the diff, and writes only on 'Open draft PR' with the digest", async () => {
    serve((c) =>
      c.body.confirm === true
        ? { body: { diff: DIFF, willCreate: false, willModify: true, pr: { url: "https://github.com/xkazm04/kp/pull/9", number: 9, branch: "b", reused: false } } }
        : { body: { diff: DIFF, willCreate: false, willModify: true } },
    );
    render(<AdmissionEnforce org="acme" view={VIEW} onSaved={() => {}} />);

    fireEvent.change(screen.getByLabelText(/reviewing teams/i), { target: { value: "@acme/platform" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview CODEOWNERS change" }));

    expect(await screen.findByText(/\+\/billing\/ @acme\/platform/)).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: "/api/org/admission/propose",
      method: "POST",
      body: { org: "acme", repo: "xkazm04/kp", owners: ["@acme/platform"], confirm: false },
    });
    // Nothing was written yet: no confirm:true request exists until the second, deliberate click.
    expect(calls.some((c) => c.body.confirm === true)).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Open draft PR" }));
    expect(await screen.findByRole("link", { name: /draft PR #9/i })).toBeTruthy();
    expect(calls[1]!.body).toEqual({
      org: "acme",
      repo: "xkazm04/kp",
      owners: ["@acme/platform"],
      confirm: true,
      expectDiffDigest: artifactFingerprint(DIFF),
    });
  });

  it("an empty diff says there is no change and offers no PR", async () => {
    serve(() => ({ body: { diff: "", willCreate: false, willModify: false } }));
    render(<AdmissionEnforce org="acme" view={VIEW} onSaved={() => {}} />);

    fireEvent.change(screen.getByLabelText(/reviewing teams/i), { target: { value: "@acme/platform" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview CODEOWNERS change" }));

    expect(await screen.findByText("no change: CODEOWNERS already carries this block")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open draft PR" })).toBeNull();
  });
});

describe("AdmissionEnforce — ruleset", () => {
  it("previews the ruleset beside the observed ones, with zero writes", async () => {
    serve(() => ({ body: { proposal: { name: "ascent:ai-oversight (xkazm04/kp)", rules: [{ type: "pull_request" }] }, observed: [{ id: 1, name: "legacy-main", enforcement: "active" }] } }));
    render(<AdmissionEnforce org="acme" view={VIEW} onSaved={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Preview ruleset" }));
    expect(await screen.findByText(/legacy-main/)).toBeTruthy();
    expect(calls[0]).toEqual({ url: "/api/org/admission/ruleset", method: "POST", body: { org: "acme", repo: "xkazm04/kp", dryRun: true } });
    expect(screen.getByRole("button", { name: "Apply ruleset" }).hasAttribute("disabled")).toBe(true);
  });

  it("revert stays disabled until the typed name matches, then DELETEs and calls onSaved", async () => {
    serve(() => ({ body: { ok: true, reverted: "42" } }));
    const onSaved = vi.fn();
    render(<AdmissionEnforce org="acme" view={{ ...VIEW, rulesetId: "42" }} onSaved={onSaved} />);

    const revert = screen.getByRole("button", { name: "Revert ruleset" });
    const typed = screen.getByLabelText(/type xkazm04\/kp to confirm/i);
    expect(revert.hasAttribute("disabled")).toBe(true);
    fireEvent.change(typed, { target: { value: "xkazm04/KP" } });
    expect(revert.hasAttribute("disabled")).toBe(true);
    fireEvent.change(typed, { target: { value: "xkazm04/kp" } });
    expect(revert.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("button", { name: "Apply ruleset" })).toBeNull();

    fireEvent.click(revert);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ url: "/api/org/admission/ruleset", method: "DELETE", body: { org: "acme", repo: "xkazm04/kp", confirm: "xkazm04/kp" } }]);
  });
});

describe("AdmissionRow — who sees the enforcement controls", () => {
  it("canEdit=false renders none of them", () => {
    render(<AdmissionRow org="acme" view={{ ...VIEW, rulesetId: "42" }} canEdit={false} onSaved={() => {}} />);
    expect(screen.queryByRole("button", { name: /enforce/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /preview|revert|apply|open draft/i })).toBeNull();
  });

  it("an owner opens the panel from the row", () => {
    render(<AdmissionRow org="acme" view={VIEW} canEdit onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /enforce/i }));
    expect(screen.getByRole("button", { name: "Preview CODEOWNERS change" })).toBeTruthy();
  });
});
