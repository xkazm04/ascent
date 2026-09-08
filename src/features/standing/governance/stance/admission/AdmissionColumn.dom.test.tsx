// @vitest-environment jsdom
//
// The render half of "the Admission column can make its first decision" (#8).
//
// The failure this pins: the column listed the DECISION table, nothing on a person's path writes to
// it, so an org that had never called a gate saw one sentence — "No repository has an admission
// decision yet" — and no repository to click. The list is now the org's tracked repositories, so
// every one of them carries the owner-only override control and the first decision is reachable.
//
// The second invariant is the one a refactor would quietly lose: a repo with no passport and no
// decision must NOT render as "Assisted only". No admission row exists for it, the gate applies no
// bar, and painting it with the middle rung's label would claim an enforcement that is not there.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { RepoAdmissionRow } from "@/lib/org/admission";

// The column opens on a BandLadder from the shared viz kit, which reaches `window.matchMedia` via
// `usePrefersReducedMotion`. jsdom implements none; `vitest.setup.dom.js` installs the shared stub.

const { AdmissionColumn } = await import("./AdmissionColumn");

const derived = (repoFullName: string, derivedTier: "T2" | null): RepoAdmissionRow => ({
  id: "",
  repoFullName,
  stanceVersion: 4,
  derivedTier,
  grantedTier: derivedTier ?? "T0",
  mode: "assisted-only",
  decidedBy: null,
  decidedAt: null,
  rationale: "",
  rulesetId: null,
  createdAt: "",
  updatedAt: "",
});

const decided = (repoFullName: string): RepoAdmissionRow => ({
  ...derived(repoFullName, "T2"),
  id: "a1",
  grantedTier: "T3",
  derivedTier: "T1",
  mode: "agents-allowed",
  decidedBy: "octocat",
  decidedAt: "2026-08-30T00:00:00.000Z",
});

function serve(rows: RepoAdmissionRow[], stanceVersion: number | null = 4) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ rows, stanceVersion }), { headers: { "content-type": "application/json" } })),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("AdmissionColumn", () => {
  it("renders every tracked repo with an override control when NOTHING has been decided", async () => {
    serve([derived("acme/api", null), derived("acme/web", "T2")]);
    render(<AdmissionColumn org="acme" canEdit />);

    expect(await screen.findByText("api")).toBeTruthy();
    expect(screen.getByText("web")).toBeTruthy();
    // One control per repo — the affordance that was missing entirely.
    expect(screen.getAllByRole("button", { name: /record decision/i })).toHaveLength(2);
    // And the empty-state sentence is NOT shown: the org has repositories, it just has no decisions.
    expect(screen.queryByText(/tracks no repositories/i)).toBeNull();
  });

  it("never paints an unassessed repo with a mode it is not held to", async () => {
    serve([derived("acme/api", null)]);
    render(<AdmissionColumn org="acme" canEdit />);

    expect(await screen.findByText("Not assessed")).toBeTruthy();
    expect(screen.getByText(/no admission bar applies here/i)).toBeTruthy();
    // Scoped to the row's own label: "Assisted only" is legitimately an OPTION in the mode select —
    // it is a decision the owner may make, just not a state they are already in.
    expect(screen.queryByText("Assisted only", { selector: "span" })).toBeNull();
    // Still decidable: an owner may block a repo no scan has graded.
    expect(screen.getByRole("button", { name: /record decision/i })).toBeTruthy();
  });

  it("shows a stored decision as a DECISION, with its author", async () => {
    serve([decided("acme/billing")]);
    render(<AdmissionColumn org="acme" canEdit />);

    expect(await screen.findByText("Agents allowed", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("decided by @octocat")).toBeTruthy();
    // Twice on purpose: once in the row's summary and once beside the select an owner is editing —
    // "what am I departing from" has to be answerable at the moment of departure, not only after it.
    expect(screen.getAllByText(/overrides derived T1/)).toHaveLength(2);
  });

  it("offers no control to a member who may not edit", async () => {
    serve([derived("acme/web", "T2")]);
    render(<AdmissionColumn org="acme" canEdit={false} />);

    expect(await screen.findByText("web")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /record decision/i })).toBeNull();
  });

  it("says the org tracks nothing only when the list is genuinely empty", async () => {
    serve([]);
    render(<AdmissionColumn org="acme" canEdit />);
    expect(await screen.findByText(/tracks no repositories yet/i)).toBeTruthy();
  });

  it("SAYS an unreadable list is unreadable — an empty column would read as 'nothing is restricted'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    render(<AdmissionColumn org="acme" canEdit />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not be read/i));
  });
});
