// @vitest-environment jsdom
//
// The v2 apply controls read their responses through readApiResponse too (council r2 robustness-5):
// a non-JSON error body shows the control's copy, and content-drift still drops the stale preview.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PracticeApplyV2 } from "./PracticeApply.v2";
import { RegistryPracticeApplyV2 } from "./RegistryPracticeApply.v2";

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
const previewed = {
  ok: true,
  status: 200,
  json: async () => ({ artifact: { path: "AGENTS.md", body: "# s" }, shape: { kind: "generic" } }),
};
const timeoutPage = {
  ok: false,
  status: 504,
  json: async () => {
    throw new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON");
  },
};

const mount = () => render(<PracticeApplyV2 org="acme" practiceId="agent-guidance" gapRepos={repos} />);
const clickPreview = () => fireEvent.click(screen.getByRole("button", { name: "Preview starter" }));

describe("PracticeApplyV2: errors", () => {
  it("a non-JSON 504 on preview shows the fallback copy, not a SyntaxError", async () => {
    fetchMock.mockResolvedValue(timeoutPage);
    mount();
    clickPreview();
    expect(await screen.findByText("Failed to generate.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/SyntaxError|not valid JSON/);
  });

  it("content-drift on apply shows the server's copy and drops the preview", async () => {
    fetchMock.mockResolvedValueOnce(previewed).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: "Content changed since preview. Re-preview.", code: "content-drift" }),
    });
    mount();
    clickPreview();
    await screen.findByTestId("practice-preview-shape");
    fireEvent.click(screen.getByRole("button", { name: /open draft pr/i }));
    expect(await screen.findByText("Content changed since preview. Re-preview.")).toBeTruthy();
    expect(screen.queryByTestId("practice-preview-shape")).toBeNull();
  });
});

describe("RegistryPracticeApplyV2: errors", () => {
  it("a non-JSON 504 shows the fallback copy", async () => {
    fetchMock.mockResolvedValue(timeoutPage);
    render(<RegistryPracticeApplyV2 org="acme" slug="s" title="T" repoOptions={["acme/a"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy into a repo →" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open draft PR" }));
    expect(await screen.findByText("Failed to open the PR.")).toBeTruthy();
  });
});
