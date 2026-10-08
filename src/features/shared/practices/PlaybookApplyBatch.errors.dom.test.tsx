// @vitest-environment jsdom
//
// The playbook fleet rollout reads its answer through readApiResponse (council r3 pre-pass): a
// non-JSON error body shows the control's copy, a JSON error shows its text, success is unchanged.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PlaybookApplyBatch } from "./PlaybookApplyBatch";

const fetchMock = vi.fn();
const onApplied = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  onApplied.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const timeoutPage = {
  ok: false,
  status: 504,
  json: async () => {
    throw new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON");
  },
};

async function runBatch() {
  render(
    <PlaybookApplyBatch
      playbookId="p1"
      title="Adopt CI"
      org="acme"
      repoOptions={["acme/a", "acme/b"]}
      applied={[]}
      singleBusy={false}
      onBusyChange={() => {}}
      onApplied={onApplied}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Roll out to the fleet/ }));
  fireEvent.click(screen.getByRole("button", { name: /Open draft PRs across 2 repos/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Open 2 PRs" }));
}

describe("PlaybookApplyBatch: the whole-call error", () => {
  it("a non-JSON 504 shows the fallback copy, not a SyntaxError", async () => {
    fetchMock.mockResolvedValue(timeoutPage);
    await runBatch();
    expect(await screen.findByText("Failed to open PRs.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/SyntaxError|not valid JSON/);
  });

  it("shows the server's JSON error text", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "Not repositories of acme: x/y." }) });
    await runBatch();
    expect(await screen.findByText("Not repositories of acme: x/y.")).toBeTruthy();
  });

  it("success: reports the opened repos to the card", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { repo: "acme/a", ok: true, url: "https://github.com/acme/a/pull/1" },
          { repo: "acme/b", ok: false, error: "boom" },
        ],
        attempted: 2,
        skipped: 0,
      }),
    });
    await runBatch();
    await screen.findByText(/boom/);
    expect(onApplied).toHaveBeenCalledWith(["acme/a"]);
  });
});
