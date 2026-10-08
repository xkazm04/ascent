// @vitest-environment jsdom
//
// The fleet and registry controls' ERROR display (council r2 robustness-5): the batch's whole-call
// error (server copy, and the fallback for a non-JSON body), the registry copy's error, and the
// per-repo result lines (an ok row and a ✗ row with its error).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PracticeApply } from "./PracticeApply";
import { RegistryPracticeApply } from "./RegistryPracticeApply";
import { PracticeApplyBatchResults } from "./PracticeApplyBatchResults";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const repos = [
  { name: "a", fullName: "acme/a" },
  { name: "b", fullName: "acme/b" },
];
const timeoutPage = {
  ok: false,
  status: 504,
  json: async () => {
    throw new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON");
  },
};

async function runBatch() {
  render(<PracticeApply org="acme" practiceId="agent-guidance" gapRepos={repos} />);
  fireEvent.click(screen.getByRole("button", { name: /Roll out to the fleet/ }));
  fireEvent.click(screen.getByRole("button", { name: /Open draft PRs across 2 repos/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Open 2 PRs" }));
}

describe("PracticeApplyBatch: the whole-call error", () => {
  it("shows the server's error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "Not repositories of acme: x/y." }) });
    await runBatch();
    expect(await screen.findByText("Not repositories of acme: x/y.")).toBeTruthy();
  });

  it("a non-JSON 504 shows the fallback copy, not a SyntaxError", async () => {
    fetchMock.mockResolvedValue(timeoutPage);
    await runBatch();
    expect(await screen.findByText("Failed to open PRs.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/SyntaxError|not valid JSON/);
  });
});

describe("RegistryPracticeApply: the error path", () => {
  async function copy() {
    render(<RegistryPracticeApply org="acme" slug="s" title="T" repoOptions={["acme/a"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy into a repo/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Open draft PR" }));
  }

  it("shows the server's error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: "GitHub rejected the write." }) });
    await copy();
    expect(await screen.findByText("GitHub rejected the write.")).toBeTruthy();
  });

  it("a non-JSON 504 shows the fallback copy", async () => {
    fetchMock.mockResolvedValue(timeoutPage);
    await copy();
    expect(await screen.findByText("Failed to open the PR.")).toBeTruthy();
  });
});

describe("PracticeApplyBatchResults", () => {
  it("renders an ok row as a PR link and a failed row as ✗ with its error, and counts what opened", () => {
    render(
      <PracticeApplyBatchResults
        batchResults={[
          { repo: "acme/a", ok: true, url: "https://github.com/acme/a/pull/1", reused: false },
          { repo: "acme/b", ok: false, error: "GitHub rejected the write. Check the repo and base branch." },
        ]}
        batchSummary={{ attempted: 2, skipped: 0 }}
      />,
    );
    expect(screen.getByRole("link", { name: "PR opened" }).getAttribute("href")).toBe("https://github.com/acme/a/pull/1");
    expect(screen.getByText("✗ b: GitHub rejected the write. Check the repo and base branch.")).toBeTruthy();
    expect(document.body.textContent).toContain("Opened 1 of 2 attempted (1 failed)");
  });
});
