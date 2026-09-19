// @vitest-environment jsdom
//
// HITL: StanceApplyControl must show AI_POLICY.md bytes from a preview POST before it can
// open a PR. The first click is dry/preview (preview: true, no write); Open PR is absent
// until those bytes render, and only then posts without the preview flag.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StanceApplyControl } from "./StanceApplyControl";

const fetchMock = vi.fn();
const BODY = "# AI policy: acme\n\n> Org stance **v2**. This file is the committed copy.";
const BYTES = new TextEncoder().encode(BODY).length;

function ok(payload: Record<string, unknown>) {
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("StanceApplyControl — preview before PR", () => {
  it("first click posts preview:true and never opens a PR", async () => {
    ok({ preview: true, path: "AI_POLICY.md", body: BODY, bytes: BYTES, version: 2 });
    render(<StanceApplyControl org="acme" repos={["acme/api"]} version={2} />);

    expect(screen.queryByRole("button", { name: /open ai_policy\.md pr/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /preview ai_policy\.md/i }));

    expect((await screen.findByTestId("stance-policy-preview")).textContent).toContain("Org stance **v2**");
    expect(screen.getByTestId("stance-policy-bytes").textContent).toContain(String(BYTES));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ org: "acme", repo: "acme/api", preview: true });
  });

  it("open-PR posts without preview only after the bytes are on screen", async () => {
    ok({ preview: true, path: "AI_POLICY.md", body: BODY, bytes: BYTES, version: 2 });
    render(<StanceApplyControl org="acme" repos={["acme/api"]} version={2} />);
    fireEvent.click(screen.getByRole("button", { name: /preview ai_policy\.md/i }));
    const open = await screen.findByRole("button", { name: /open ai_policy\.md pr \(v2\)/i });

    ok({ url: "https://github.com/acme/api/pull/7", reused: false });
    fireEvent.click(open);
    expect(await screen.findByText(/draft pr opened/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init = fetchMock.mock.calls[1]![1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ org: "acme", repo: "acme/api" });
  });

  it("changing repo clears the preview so a stale body cannot be opened", async () => {
    ok({ preview: true, path: "AI_POLICY.md", body: BODY, bytes: BYTES, version: 2 });
    render(<StanceApplyControl org="acme" repos={["acme/api", "acme/web"]} version={2} />);
    fireEvent.click(screen.getByRole("button", { name: /preview ai_policy\.md/i }));
    await screen.findByTestId("stance-policy-preview");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "acme/web" } });
    expect(screen.queryByTestId("stance-policy-preview")).toBeNull();
    expect(screen.queryByRole("button", { name: /open ai_policy\.md pr/i })).toBeNull();
  });
});
