// @vitest-environment jsdom
//
// Pins the blast-radius half of the org data-erasure control: the count an owner must be SHOWN before
// echo-to-confirm means anything. Each of these is a way this UI must not lie:
//   • arming the confirm button before any count has rendered (confirming a size never shown);
//   • leaving a stale count beside a changed audit disposition (the audit casualties differ);
//   • rendering "0 scans" out of a FAILED preview — reassurance that was never received.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataErasureCard } from "./DataErasureCard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const PREVIEW = {
  orgSlug: "acme",
  scope: "org" as const,
  reposProcessed: 37,
  scansDeleted: 412,
  dimensionsDeleted: 3708,
  recommendationsDeleted: 900,
  recommendationEventsDeleted: 40,
  auditDeleted: 0,
  auditRedacted: 0,
  auditDisposition: "keep" as const,
  stoppedEarly: false,
  complete: true,
  audited: true,
  dryRun: true,
};

type Res = { ok: boolean; status: number; body: unknown };

/** Stub fetch with a per-call queue; the last entry repeats, so a test only lists what it cares about. */
function stubFetch(...responses: Res[]) {
  let i = 0;
  const mock = vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return { ok: r.ok, status: r.status, json: async () => r.body };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const ok = (body: unknown): Res => ({ ok: true, status: 200, body });
const bodyOf = (mock: ReturnType<typeof stubFetch>, call: number) =>
  JSON.parse((mock.mock.calls[call] as unknown as [string, { body: string }])[1].body);

const open = () => fireEvent.click(screen.getByRole("button", { name: /erase organization data…/i }));
const confirmInput = () => screen.getByPlaceholderText("acme") as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: /^erase acme/i }) as HTMLButtonElement;
const auditBox = () => screen.getByRole("checkbox") as HTMLInputElement;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DataErasureCard — blast-radius preview", () => {
  it("counts what would be erased when the dialog opens, and shows it beside the confirm field", async () => {
    const fetchMock = stubFetch(ok(PREVIEW));
    render(<DataErasureCard slug="acme" />);
    open();

    await screen.findByText(/Would be erased now/i);
    // The preview needs no `confirm` — it is what makes an informed confirmation possible.
    expect(bodyOf(fetchMock, 0)).toEqual({ org: "acme", preview: true, includeAudit: false });
    expect(screen.getByText("412")).toBeTruthy(); // scans
    expect(screen.getByText("37")).toBeTruthy(); // repositories
    expect(screen.getByText(/trail kept/i)).toBeTruthy();
    expect(screen.getByText(/nothing has been touched/i)).toBeTruthy();
  });

  it("re-counts when the audit disposition changes instead of leaving a stale number", async () => {
    const fetchMock = stubFetch(ok(PREVIEW), ok({ ...PREVIEW, auditRedacted: 8421, auditDisposition: "redact" }));
    render(<DataErasureCard slug="acme" />);
    open();
    await screen.findByText(/trail kept/i);

    fireEvent.click(auditBox());

    await screen.findByText(/redacted to identifier-only/i);
    expect(screen.getByText("8,421")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 1)).toEqual({ org: "acme", preview: true, includeAudit: true });
  });

  it("reports a preview stopped by its own budget as a FLOOR, not a total", async () => {
    stubFetch(ok({ ...PREVIEW, stoppedEarly: true, complete: false }));
    render(<DataErasureCard slug="acme" />);
    open();

    await screen.findByText(/Would be erased now/i);
    expect(screen.getByText("at least 412")).toBeTruthy();
    expect(screen.getByText(/the real totals are higher/i)).toBeTruthy();
  });
});

describe("DataErasureCard — the confirm gate waits for the count", () => {
  it("keeps the confirm button disabled while the preview is still in flight", async () => {
    stubFetch(ok(PREVIEW));
    render(<DataErasureCard slug="acme" />);
    open();

    // Before the count lands, the exact org name is not enough to arm the destructive button.
    fireEvent.change(confirmInput(), { target: { value: "acme" } });
    expect(submit().disabled).toBe(true);
    expect(screen.getByText(/Counting what would be erased/i)).toBeTruthy();
    expect(screen.getByText(/Waiting for the count/i)).toBeTruthy();
    // …and typing a correct name is not reported as a typo just because the count is pending.
    expect(screen.queryByText(/doesn't match acme/i)).toBeNull();

    await screen.findByText(/Would be erased now/i);
    expect(submit().disabled).toBe(false);
  });

  it("shows UNKNOWN and stays disabled when the preview fails — never a zero it did not receive", async () => {
    const fetchMock = stubFetch({ ok: false, status: 503, body: { error: "Erasure requires a database." } });
    render(<DataErasureCard slug="acme" />);
    open();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Unknown/);
    expect(alert.textContent).toMatch(/Erasure requires a database/);
    expect(screen.queryByText(/Would be erased now/i)).toBeNull();
    expect(screen.queryByText("0")).toBeNull(); // the failure invents no counts at all

    fireEvent.change(confirmInput(), { target: { value: "acme" } });
    expect(submit().disabled).toBe(true);
    fireEvent.click(submit());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); // the preview; no erase was posted
  });

  it("treats a 200 that is not a preview body as unknown rather than as counts", async () => {
    // A real erase result replayed here (no `dryRun`) would otherwise print as a would-erase count.
    stubFetch(ok({ ...PREVIEW, dryRun: undefined }));
    render(<DataErasureCard slug="acme" />);
    open();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Unknown/);
    expect(screen.queryByText("412")).toBeNull();
    fireEvent.change(confirmInput(), { target: { value: "acme" } });
    expect(submit().disabled).toBe(true);
  });

  it("re-counts on re-open rather than reusing the previous session's total", async () => {
    const fetchMock = stubFetch(ok(PREVIEW), ok({ ...PREVIEW, scansDeleted: 7 }));
    render(<DataErasureCard slug="acme" />);
    open();
    await screen.findByText("412");

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    open();

    await screen.findByText("7");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
