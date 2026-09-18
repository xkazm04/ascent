// @vitest-environment jsdom
//
// Fleet HITL: StanceApplyBatch posts /api/org/ai-stance/apply-batch only after the confirm, with
// the selected repos (3 in this pin). The Open-PR button is the confirm, not the first click.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StanceApplyBatch } from "./StanceApplyBatch";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("StanceApplyBatch — confirm then batch-open", () => {
  it("confirm posts apply-batch with 3 repos and renders 3 results", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        attempted: 3,
        skipped: 0,
        results: [
          { repo: "acme/a", ok: true, url: "https://github.com/acme/a/pull/1", reused: false },
          { repo: "acme/b", ok: true, url: "https://github.com/acme/b/pull/2", reused: false },
          { repo: "acme/c", ok: true, url: "https://github.com/acme/c/pull/3", reused: false },
        ],
      }),
    });
    render(
      <StanceApplyBatch
        org="acme"
        repos={["acme/a", "acme/b", "acme/c"]}
        version={2}
        singleBusy={false}
        onBusyChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /roll out to the fleet/i }));
    fireEvent.click(screen.getByRole("button", { name: /open draft prs across 3 repos/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^open 3 prs$/i }));

    expect(await screen.findByTestId("stance-batch-results")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]!;
    expect(init[0]).toBe("/api/org/ai-stance/apply-batch");
    expect(JSON.parse((init[1] as { body: string }).body)).toEqual({
      org: "acme",
      repos: ["acme/a", "acme/b", "acme/c"],
    });
  });
});
