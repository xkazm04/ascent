// @vitest-environment jsdom
//
// Direction 7 — the docket's dedupe made VISIBLE. The route now reuses an existing open issue for the
// same finding instead of filing a duplicate; a reuse that rendered exactly like a fresh write would
// teach the user their click did nothing, so the row says "already filed" beside the link. These pin
// (a) findingId is forwarded so the server CAN dedupe, (b) reuse renders its own label, (c) a fresh
// write does not.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { CreateIssueModal, type IssueDraft } from "./CreateIssueModal";

const draft = (over: Partial<IssueDraft> = {}): IssueDraft => ({
  title: "Agent can't self-verify",
  body: "Body.",
  findingId: "auto.self-verify-gaps",
  targets: [{ name: "app", fullName: "acme/app" }],
  ...over,
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function ok(payload: Record<string, unknown>) {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => payload });
}

async function file() {
  fireEvent.click(screen.getByRole("button", { name: /File 1 issue/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
}

describe("CreateIssueModal", () => {
  it("forwards the draft's findingId so the route can dedupe", async () => {
    ok({ url: "https://github.com/acme/app/issues/9", number: 9, reused: false });
    render(<CreateIssueModal draft={draft()} onClose={() => {}} />);

    await file();

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.findingId).toBe("auto.self-verify-gaps");
    expect(body.repo).toBe("acme/app");
  });

  it("labels a reused issue 'already filed' next to its link", async () => {
    ok({ url: "https://github.com/acme/app/issues/9", number: 9, reused: true });
    render(<CreateIssueModal draft={draft()} onClose={() => {}} />);

    await file();

    expect(await screen.findByText("already filed")).toBeTruthy();
    const link = await screen.findByRole("link", { name: /#9/ });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/app/issues/9");
  });

  it("does NOT claim 'already filed' for a fresh write", async () => {
    ok({ url: "https://github.com/acme/app/issues/9", number: 9, reused: false });
    render(<CreateIssueModal draft={draft()} onClose={() => {}} />);

    await file();

    await screen.findByRole("link", { name: /#9/ });
    expect(screen.queryByText("already filed")).toBeNull();
  });

  it("omits findingId when the draft carries none (un-deduped callers unchanged)", async () => {
    ok({ url: "u", number: 1, reused: false });
    render(<CreateIssueModal draft={draft({ findingId: undefined })} onClose={() => {}} />);

    await file();

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body)).findingId).toBeUndefined();
  });
});
