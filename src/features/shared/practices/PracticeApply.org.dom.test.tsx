// @vitest-environment jsdom
//
// The practice apply clients send the DASHBOARD org in the body, and the batch confirm names that org,
// not the first repo's owner: an org's slug can differ from the owner of the repos it tracks (org
// `kiro` over `xkazm04/*`), and the routes gate, mint and audit on `org`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { PracticeApply } from "./PracticeApply";
import { RegistryPracticeApply } from "./RegistryPracticeApply";

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
  { name: "x", fullName: "xkazm04/x" },
  { name: "y", fullName: "xkazm04/y" },
];

const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call]![1].body as string);

describe("PracticeApply sends the dashboard org", () => {
  it("includes org in the preview and the apply body", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ artifact: { path: "AGENTS.md", body: "# s" }, shape: { kind: "generic" }, url: "u", number: 1 }),
    });
    render(<PracticeApply org="kiro" practiceId="agent-guidance" gapRepos={repos} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview starter" }));
    await screen.findByTestId("practice-preview-shape");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/practices/generate");
    expect(bodyOf(0)).toMatchObject({ org: "kiro", repo: "xkazm04/x" });

    fireEvent.click(screen.getByRole("button", { name: /open draft pr/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/practices/apply");
    expect(bodyOf(1)).toMatchObject({ org: "kiro", repo: "xkazm04/x" });
  });
});

describe("PracticeApplyBatch names and sends the dashboard org", () => {
  it("the confirm names kiro (not the repos' owner xkazm04) and the batch body carries org", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [], attempted: 2, skipped: 0 }),
    });
    render(<PracticeApply org="kiro" practiceId="agent-guidance" gapRepos={repos} />);
    fireEvent.click(screen.getByRole("button", { name: /Roll out to the fleet/ }));
    fireEvent.click(screen.getByRole("button", { name: /Open draft PRs across 2 repos/ }));

    expect(await screen.findByText("Open 2 draft PRs across 2 kiro repos?")).toBeTruthy();
    expect(document.body.textContent).toContain("under kiro");
    expect(document.body.textContent).not.toContain("xkazm04 repos");

    fireEvent.click(screen.getByRole("button", { name: "Open 2 PRs" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/practices/apply-batch");
    expect(bodyOf(0)).toMatchObject({ org: "kiro", practiceId: "agent-guidance" });
  });
});

describe("RegistryPracticeApply sends the dashboard org", () => {
  it("includes org in the apply body", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ url: "u", reused: false }) });
    render(<RegistryPracticeApply org="kiro" slug="s" title="T" repoOptions={["xkazm04/x"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy into a repo/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Open draft PR" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(0)).toMatchObject({ org: "kiro", repo: "xkazm04/x", practiceId: "registry:s" });
  });
});
