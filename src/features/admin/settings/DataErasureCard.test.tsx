// @vitest-environment jsdom
//
// Pins the destructive-action UX of the org data-erasure control (G2-34). The route is trivial; the
// ways this UI can lie are not, so each of these is a way it must NOT read:
//   • submit armed by anything other than the org's name typed back exactly;
//   • a 207 `resumable` partial rendered as either success or failure (it is neither — run it again);
//   • `audited: false` rendered as a clean success (the deletes stand, the compliance trace is gone).
// The blast-radius preview that arms the field has its own file: DataErasurePreview.test.tsx.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataErasureCard } from "./DataErasureCard";
import { confirmMatches } from "./DataErasureDialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** The `preview: true` body the dialog fetches on open. The confirm button is dead until this lands,
 *  so every test here has to get past it before it can exercise anything else. */
const PREVIEW = {
  orgSlug: "acme",
  scope: "org" as const,
  reposProcessed: 3,
  scansDeleted: 120,
  dimensionsDeleted: 1080,
  recommendationsDeleted: 340,
  recommendationEventsDeleted: 12,
  auditDeleted: 0,
  auditRedacted: 0,
  auditDisposition: "keep" as const,
  stoppedEarly: false,
  complete: true,
  audited: true,
  dryRun: true,
};

const OK = {
  orgSlug: "acme",
  scope: "org" as const,
  reposProcessed: 3,
  scansDeleted: 120,
  dimensionsDeleted: 1080,
  recommendationsDeleted: 340,
  recommendationEventsDeleted: 12,
  auditDeleted: 0,
  stoppedEarly: false,
  complete: true,
  audited: true,
};

function mockPost(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const eraseButton = () => screen.getByRole("button", { name: /erase organization data…/i });
const confirmInput = () => screen.getByPlaceholderText("acme") as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: /^erase acme$/i }) as HTMLButtonElement;

beforeEach(async () => {
  // The preview is answered first; each test then re-stubs fetch for the erase itself, so the
  // per-test fetch mocks below count ONLY erase calls.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => PREVIEW })));
  render(<DataErasureCard slug="acme" />);
  fireEvent.click(eraseButton());
  await screen.findByText(/Would be erased now/i);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DataErasureCard — typed confirmation gate", () => {
  it("blocks submit until the org name is typed back exactly", async () => {
    const fetchMock = mockPost(200, OK);

    expect(submit().disabled).toBe(true); // empty
    fireEvent.change(confirmInput(), { target: { value: "acm" } });
    expect(submit().disabled).toBe(true); // prefix
    fireEvent.change(confirmInput(), { target: { value: "ACME" } });
    expect(submit().disabled).toBe(true); // wrong case is not an exact echo
    expect(screen.getByText(/doesn't match acme/i)).toBeTruthy();

    fireEvent.click(submit());
    expect(fetchMock).not.toHaveBeenCalled(); // a disabled destructive button never fires

    fireEvent.change(confirmInput(), { target: { value: " acme " } }); // paste whitespace is forgiven
    expect(submit().disabled).toBe(false);

    fireEvent.click(submit());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toEqual({ org: "acme", confirm: "acme", includeAudit: false });
  });

  it("names what is destroyed and what survives, specifically", () => {
    expect(screen.getByText(/Erased, permanently/i)).toBeTruthy();
    expect(screen.getByText(/Kept, untouched/i)).toBeTruthy();
    expect(screen.getByText(/Every repository's scan-derived cache/i)).toBeTruthy();
    expect(screen.getByText(/watched, their scan schedules/i)).toBeTruthy();
    // The audit trail moves columns with the opt-in rather than being described vaguely.
    expect(screen.getByText(/Tick the box below to erase it too/i)).toBeTruthy();
  });
});

describe("DataErasureCard — degraded outcomes", () => {
  async function runWith(status: number, body: unknown) {
    const fetchMock = mockPost(status, body);
    fireEvent.change(confirmInput(), { target: { value: "acme" } });
    fireEvent.click(submit());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    return fetchMock;
  }

  it("renders a 207 partial as RESUMABLE — not success, not failure", async () => {
    await runWith(207, {
      ...OK,
      scansDeleted: 40,
      stoppedEarly: true,
      complete: false,
      resumable: true,
      error: "Erasure stopped at a safe boundary before finishing — repeat this request to resume.",
    });

    await screen.findByText(/Stopped at a safe boundary/i);
    expect(screen.getByText(/Running it again picks up exactly where it stopped/i)).toBeTruthy();
    // Not success…
    expect(screen.queryByText(/Every scan in scope is erased/i)).toBeNull();
    expect(screen.queryByText(/Erased every scan in acme/i)).toBeNull();
    // …and the way forward is a real control, not prose.
    const resume = screen.getByRole("button", { name: /continue erasing/i });
    expect((resume as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: /stop here/i })).toBeTruthy();
  });

  it("resumes with the identical request and accumulates the counts across passes", async () => {
    const fetchMock = await runWith(207, { ...OK, scansDeleted: 40, stoppedEarly: true, complete: false, resumable: true });
    await screen.findByRole("button", { name: /continue erasing/i });

    mockPost(200, { ...OK, scansDeleted: 80 });
    fireEvent.click(screen.getByRole("button", { name: /continue erasing/i }));

    await screen.findByText(/Erased every scan in acme/i);
    expect(screen.getByText("120")).toBeTruthy(); // 40 + 80 across both passes
    expect(screen.getByText(/2 passes/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1); // the first mock; the resume used the second
  });

  it("never renders audited:false as a clean success", async () => {
    await runWith(207, {
      ...OK,
      audited: false,
      error: "Data erased, but the data.erased audit entry could not be written.",
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/audit entry could not be written/i);
    expect(alert.textContent).toMatch(/Record it out of band/i);
    expect(screen.getByText(/the compliance record was not written/i)).toBeTruthy();
    expect(screen.queryByText(/Every scan in scope is erased/i)).toBeNull();
    expect(screen.queryByText(/Erasure complete/i)).toBeNull();
  });

  it("surfaces a 4xx/5xx refusal as an error and keeps the arming dialog", async () => {
    await runWith(503, { error: "Erasure requires a database." });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Erasure requires a database/i);
    expect(screen.getByText(/Erased, permanently/i)).toBeTruthy(); // still armed, nothing claimed erased
  });
});

describe("confirmMatches", () => {
  it("accepts only the exact name, trimmed", () => {
    expect(confirmMatches("acme", "acme")).toBe(true);
    expect(confirmMatches("  acme\n", "acme")).toBe(true);
    expect(confirmMatches("ACME", "acme")).toBe(false);
    expect(confirmMatches("acme-corp", "acme")).toBe(false);
    expect(confirmMatches("", "acme")).toBe(false);
  });
});
