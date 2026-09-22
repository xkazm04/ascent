// @vitest-environment jsdom
//
// Pins the auto-add-by-language RECONCILIATION (repositories-segments #3): after a bulk tag, the
// segment's repo count must reflect the SERVER's authoritative "rows changed", NOT the client's
// optimistic guess. The optimistic path bumps the chip by how many repos the client THOUGHT were new;
// when the server creates fewer (a fullName that isn't the org's, or one already tagged server-side),
// trusting the client leaves the chip permanently overstating the segment — and skews the Overview
// filter + segment comparison the count feeds.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";

// The bulk-tag network call is the seam under test: make it return a server "changed" count that the
// client's optimistic guess deliberately won't match, then assert the chip reconciles to the server's.
const bulkTagRepos = vi.fn();
vi.mock("@/lib/org/segment-actions", () => ({
  bulkTagRepos: (...args: unknown[]) => bulkTagRepos(...args),
}));

import { RepoSegmentsPanel } from "@/features/standing/repositories/RepoSegmentsPanel";

afterEach(() => vi.restoreAllMocks());
beforeEach(() => vi.clearAllMocks());

const REPOS = ["a/r1", "a/r2", "a/r3", "a/r4", "a/r5"].map((fullName) => ({
  fullName,
  name: fullName.split("/")[1]!,
  language: "TypeScript",
}));

function renderPanel() {
  return render(
    <RepoSegmentsPanel
      slug="acme"
      repos={REPOS}
      segments={[{ id: "seg1", name: "platform", color: "#3b9eff", repoCount: 0 }]}
      membership={{}}
    />,
  );
}

/** The "platform" chip span, scoped via its ✎ edit button so the count assertion can't match the
 *  language option "(5)" or the "5 repos" footer elsewhere on the panel. */
function chip() {
  return screen.getByLabelText("Edit platform segment").closest("span")!;
}

describe("RepoSegmentsPanel — auto-add reconciles the count with the server (DOM)", () => {
  it("bulk-tags only repos attributed to the selected CODEOWNERS team", async () => {
    bulkTagRepos.mockResolvedValue(2);
    render(
      <RepoSegmentsPanel
        slug="acme"
        repos={[
          { fullName: "a/r1", name: "r1", teams: ["@acme/platform", "@acme/shared"] },
          { fullName: "a/r2", name: "r2", teams: ["@acme/platform"] },
          { fullName: "a/r3", name: "r3", teams: ["@acme/payments"] },
        ]}
        segments={[{ id: "seg1", name: "platform", color: "#3b9eff", repoCount: 0 }]}
        membership={{}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Auto-add mode"), { target: { value: "team" } });
    fireEvent.change(screen.getByLabelText("Auto-add team"), { target: { value: "@acme/platform" } });
    fireEvent.change(screen.getByLabelText("Auto-add target segment"), { target: { value: "seg1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add all" }));

    await waitFor(() => expect(within(chip()).getByText("2 tagged")).toBeInTheDocument());
    expect(bulkTagRepos).toHaveBeenCalledWith("seg1", {
      org: "acme", fullNames: ["a/r1", "a/r2"], member: true,
    });
  });

  it("corrects an over-optimistic count down to the server's 'changed' total", async () => {
    // 5 untagged TS repos → the client optimistically counts +5. The server reports only 4 rows created
    // (one repo isn't the org's / was already tagged). The chip must settle on 4, never the optimistic 5.
    bulkTagRepos.mockResolvedValue(4);
    renderPanel();

    expect(within(chip()).getByText("0 tagged")).toBeInTheDocument(); // starts at 0 tagged

    fireEvent.change(screen.getByLabelText("Auto-add language"), { target: { value: "TypeScript" } });
    fireEvent.change(screen.getByLabelText("Auto-add target segment"), { target: { value: "seg1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add all" }));

    await waitFor(() => expect(within(chip()).getByText("4 tagged")).toBeInTheDocument());
    expect(within(chip()).queryByText("5 tagged")).toBeNull(); // NOT the over-optimistic client guess
    expect(bulkTagRepos).toHaveBeenCalledWith("seg1", {
      org: "acme",
      fullNames: REPOS.map((r) => r.fullName),
      member: true,
    });
  });

  it("keeps the optimistic count when the server confirms every tag (no spurious correction)", async () => {
    bulkTagRepos.mockResolvedValue(5); // all 5 created — client guess was right
    renderPanel();

    fireEvent.change(screen.getByLabelText("Auto-add language"), { target: { value: "TypeScript" } });
    fireEvent.change(screen.getByLabelText("Auto-add target segment"), { target: { value: "seg1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add all" }));

    await waitFor(() => expect(within(chip()).getByText("5 tagged")).toBeInTheDocument());
  });
});
