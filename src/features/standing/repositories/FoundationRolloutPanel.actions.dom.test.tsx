// @vitest-environment jsdom
//
// moonshot #35 — the rollout panel's two WRITE doors: the bulk install and the per-repo report-back
// confirmation. Split from FoundationRolloutPanel.dom.test.tsx for the 200-LOC features cap; that
// file keeps the panel's honest-state assertions, this one keeps everything that issues a request.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { FoundationRolloutPanel } from "./FoundationRolloutPanel";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";

const row = (over: Partial<FoundationRolloutRow> & { repo: string }): FoundationRolloutRow => ({
  foundationPrAt: null,
  reportBackAt: null,
  conformance: null,
  conformanceAt: null,
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
beforeEach(() => vi.clearAllMocks());

function mockFetch(response: unknown, ok = true) {
  const fn = vi.fn(async () => ({ ok, json: async () => response }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("bulk install", () => {
  it("counts only the repos that have NO foundation PR yet", () => {
    render(
      <FoundationRolloutPanel
        slug="acme"
        rows={[row({ repo: "acme/app", foundationPrAt: "2026-08-01T00:00:00.000Z" }), row({ repo: "acme/api" })]}
      />,
    );
    expect(screen.getByRole("button", { name: "Install the foundation in 1 repo" })).toBeEnabled();
  });

  it("disables the bulk action once every repo is installed", () => {
    render(
      <FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app", foundationPrAt: "2026-08-01T00:00:00.000Z" })]} />,
    );
    // NOT "Foundation installed everywhere": an opened draft PR is not a merged install.
    expect(screen.getByRole("button", { name: "Foundation PR opened in every repo" })).toBeDisabled();
  });

  it("POSTs only the missing repos and reports the outcome", async () => {
    const fetchFn = mockFetch({ results: [{ ok: true }], attempted: 1, skipped: 0 });
    render(
      <FoundationRolloutPanel
        slug="acme"
        rows={[row({ repo: "acme/app", foundationPrAt: "2026-08-01T00:00:00.000Z" }), row({ repo: "acme/api" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Install the foundation/ }));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    const body = JSON.parse(fetchFn.mock.calls[0]![1].body as string);
    expect(body).toEqual({ org: "acme", repos: ["acme/api"] });
    expect(screen.getByRole("status").textContent).toMatch(/Opened 1 draft PR/);
    expect(refresh).toHaveBeenCalled();
  });

  it("surfaces the server's refusal instead of claiming success", async () => {
    mockFetch({ error: "This action requires the admin role." }, false);
    render(<FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/api" })]} />);
    fireEvent.click(screen.getByRole("button", { name: /Install the foundation/ }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/admin role/));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("report-back confirmation", () => {
  it("cannot be submitted until the full owner/repo is typed", async () => {
    const fetchFn = mockFetch({ results: [{ ok: true }] });
    render(<FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Set up report-back" }));

    const dialog = screen.getByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Write the secrets" });
    expect(submit).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Type acme/app to confirm"), { target: { value: "acme/ap" } });
    expect(submit).toBeDisabled();
    expect(fetchFn).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText("Type acme/app to confirm"), { target: { value: "acme/app" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(fetchFn.mock.calls[0]![1].method).toBe("POST");
    expect(JSON.parse(fetchFn.mock.calls[0]![1].body as string)).toEqual({
      org: "acme",
      repos: ["acme/app"],
      confirm: "acme/app",
    });
  });

  it("discloses both secret names and the App permission BEFORE any request", () => {
    const fetchFn = mockFetch({});
    render(<FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Set up report-back" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/ASCENT_CONFORMANCE_URL/)).toBeTruthy();
    expect(within(dialog).getByText(/ASCENT_CONFORMANCE_TOKEN/)).toBeTruthy();
    expect(within(dialog).getByText(/Secrets: write/)).toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("a provisioned repo offers Remove, which DELETEs", async () => {
    const fetchFn = mockFetch({ results: [{ ok: true }], removed: 2 });
    render(<FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app", reportBackAt: "2026-08-02T00:00:00.000Z" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Type acme/app to confirm"), { target: { value: "acme/app" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove and revoke" }));
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(fetchFn.mock.calls[0]![1].method).toBe("DELETE");
  });

  it("keeps the dialog open and shows GitHub's own refusal when the write fails", async () => {
    mockFetch({ results: [{ ok: false, error: "The installation lacks Secrets write access." }] });
    render(<FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Set up report-back" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Type acme/app to confirm"), { target: { value: "acme/app" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Write the secrets" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Secrets write access/));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
