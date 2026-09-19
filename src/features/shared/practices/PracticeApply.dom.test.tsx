// @vitest-environment jsdom
//
// The preview kicker: when an artifact is shown, exactly one shape line names it as a house
// pattern (from N exemplars) or a generic starter. The generate payload's `shape` is the source.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PracticeApply } from "./PracticeApply";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const repos = [{ name: "web", fullName: "acme/web" }];

function ok(payload: Record<string, unknown>) {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => payload });
}

async function preview() {
  render(<PracticeApply practiceId="agent-guidance" gapRepos={repos} />);
  fireEvent.click(screen.getByRole("button", { name: "Preview starter" }));
  await screen.findByTestId("practice-preview-shape");
}

describe("PracticeApply preview shape kicker", () => {
  it("shows no shape line until an artifact is previewed", () => {
    render(<PracticeApply practiceId="agent-guidance" gapRepos={repos} />);
    expect(screen.queryByTestId("practice-preview-shape")).toBeNull();
  });

  it("labels a house-shaped preview as House pattern from N exemplars", async () => {
    ok({
      artifact: { path: "AGENTS.md", body: "# starter" },
      shape: { kind: "house", exemplars: 3 },
    });
    await preview();
    expect(screen.getByTestId("practice-preview-shape").textContent).toBe("House pattern from 3 exemplars");
    expect(screen.getAllByTestId("practice-preview-shape")).toHaveLength(1);
  });

  it("labels a generic preview as Generic starter (no mined pattern yet)", async () => {
    ok({
      artifact: { path: "AGENTS.md", body: "# starter" },
      shape: { kind: "generic" },
    });
    await preview();
    expect(screen.getByTestId("practice-preview-shape").textContent).toBe(
      "Generic starter (no mined pattern yet)",
    );
    expect(screen.getAllByTestId("practice-preview-shape")).toHaveLength(1);
  });
});
