// @vitest-environment jsdom
//
// The single-repo apply control's ERROR display (council r2 robustness-5): the preview error, the apply
// error, content-drift dropping the stale preview, and a non-JSON error body (a platform timeout page)
// showing the control's own copy instead of a raw JSON SyntaxError.

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
const previewed = {
  ok: true,
  status: 200,
  json: async () => ({ artifact: { path: "AGENTS.md", body: "# s" }, shape: { kind: "generic" } }),
};
const failing = (status: number, body: Record<string, unknown>) => ({ ok: false, status, json: async () => body });
// What a platform timeout page looks like to res.json(): an HTML body that does not parse.
const timeoutPage = {
  ok: false,
  status: 504,
  json: async () => {
    throw new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON");
  },
};
const RAW_PARSE_ERROR = /SyntaxError|not valid JSON|Unexpected token/;

function mount() {
  render(<PracticeApply org="acme" practiceId="agent-guidance" gapRepos={repos} />);
}
const clickPreview = () => fireEvent.click(screen.getByRole("button", { name: "Preview starter" }));

async function previewThenApply() {
  mount();
  clickPreview();
  await screen.findByTestId("practice-preview-shape");
  fireEvent.click(screen.getByRole("button", { name: /open draft pr/i }));
}

describe("PracticeApply: preview errors", () => {
  it("shows the server's preview error", async () => {
    fetchMock.mockResolvedValue(failing(502, { error: "Failed to mint an installation token for this org." }));
    mount();
    clickPreview();
    expect(await screen.findByText("Failed to mint an installation token for this org.")).toBeTruthy();
    expect(screen.queryByTestId("practice-preview-shape")).toBeNull();
  });

  it("a non-JSON 504 shows the fallback copy, not a SyntaxError", async () => {
    fetchMock.mockResolvedValue(timeoutPage);
    mount();
    clickPreview();
    expect(await screen.findByText("Failed to generate.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(RAW_PARSE_ERROR);
  });
});

describe("PracticeApply: apply errors", () => {
  it("shows the server's apply error and keeps the preview", async () => {
    fetchMock.mockResolvedValueOnce(previewed).mockResolvedValueOnce(failing(403, { error: "Ascent isn't installed on acme." }));
    await previewThenApply();
    expect(await screen.findByText("Ascent isn't installed on acme.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /open draft pr/i })).toBeTruthy();
  });

  it("content-drift drops the stale preview, so the apply button disappears", async () => {
    fetchMock
      .mockResolvedValueOnce(previewed)
      .mockResolvedValueOnce(failing(409, { error: "Content changed since preview. Re-preview.", code: "content-drift" }));
    await previewThenApply();
    expect(await screen.findByText("Content changed since preview. Re-preview.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open draft pr/i })).toBeNull();
    expect(screen.queryByTestId("practice-preview-shape")).toBeNull();
  });

  it("a non-JSON 504 on apply shows the fallback copy, not a SyntaxError", async () => {
    fetchMock.mockResolvedValueOnce(previewed).mockResolvedValueOnce(timeoutPage);
    await previewThenApply();
    expect(await screen.findByText("Failed to open PR.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(RAW_PARSE_ERROR);
  });
});
