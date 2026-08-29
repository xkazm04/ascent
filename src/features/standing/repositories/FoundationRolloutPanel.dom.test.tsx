// @vitest-environment jsdom
//
// moonshot #35 — the rollout panel's honesty and its confirmation door:
//   • a never-reported repo shows "—", never "0%", and the legend says which it is;
//   • an un-provisioned repo reads "Not provisioned", never "off";
//   • the credential write is unreachable until the operator types the full owner/repo;
//   • both `data-tour` anchors the getting-started checklist declares are actually stamped here.

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

describe("honest empties", () => {
  it("renders — (not 0%) for a never-reported repo, and says so in the legend", () => {
    render(<FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app" })]} />);
    const cells = screen.getAllByRole("cell");
    expect(cells.some((c) => c.textContent?.trim() === "—")).toBe(true);
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.getByText(/never reported/i)).toBeTruthy();
  });

  it("a genuine 0% report renders as 0%, not as —", () => {
    render(
      <FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app", conformance: 0, conformanceAt: "2026-08-01T00:00:00.000Z" })]} />,
    );
    expect(screen.getByText("0%")).toBeTruthy();
  });

  it("reads 'Not provisioned' / 'Not installed' rather than leaving the cells blank", () => {
    render(<FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app" })]} />);
    const cells = screen.getAllByRole("cell").map((c) => c.textContent);
    expect(cells.some((t) => t?.includes("Not provisioned"))).toBe(true);
    expect(cells.some((t) => t?.includes("Not installed"))).toBe(true);
  });

  it("renders nothing at all when the org has no repos", () => {
    const { container } = render(<FoundationRolloutPanel slug="acme" rows={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("tour anchors", () => {
  it("stamps both anchors the getting-started checklist declares", () => {
    const { container } = render(<FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app" })]} />);
    expect(container.querySelector('[data-tour="foundation-rollout"]')).toBeTruthy();
    expect(container.querySelector('[data-tour="conformance-reported"]')).toBeTruthy();
  });
});

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
    expect(screen.getByRole("button", { name: "Foundation installed everywhere" })).toBeDisabled();
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
