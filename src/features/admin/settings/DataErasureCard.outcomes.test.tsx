// @vitest-environment jsdom
//
// The RESULT half of the org data-erasure control (G2-34): what the receipt is allowed to say once
// POST /api/org/erase has answered. Split from DataErasureCard.test.tsx to keep both siblings under
// the 200-LOC `src/features/**` cap; the arming half (typed confirmation, manifest) stays there, and
// the blast-radius preview has its own file again in DataErasurePreview.test.tsx.
//
// Each case is a way the receipt must NOT read:
//   • a 207 `resumable` partial as either success or failure (it is neither — run it again);
//   • `audited: false` as a clean success (the deletes stand, the compliance trace is gone);
//   • a REDACTED audit trail as a kept one (see the regression note below).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OK, PREVIEW, confirmInput, eraseButton, mockPost, submit } from "./dataErasureTestKit";
import { DataErasureCard } from "./DataErasureCard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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

  // REGRESSION (explorer, 2026-08-29): the receipt read `auditDeleted` alone. Because
  // includeAudit:true resolves to auditDisposition "redact" — and the route 409s a real "delete"
  // unless ERASE_AUDIT_FORCE=1 — that counter is 0 on every path this UI can reach, so redacting an
  // entire trail was reported as "Audit rows 0 · audit trail kept". The one control whose job is to
  // tell the truth about an irreversible act was telling the operator the opposite of what happened.
  it("reports a redacted audit trail as redacted, with its real count", async () => {
    await runWith(200, { ...OK, auditDeleted: 0, auditRedacted: 4200, auditDisposition: "redact" });

    await screen.findByText(/Erased every scan in acme/i);
    expect(screen.getByText(/Audit rows \(redacted to identifier-only\)/i)).toBeTruthy();
    expect(screen.getByText("4,200")).toBeTruthy();
    expect(screen.getByText(/audit trail redacted to identifier-only/i)).toBeTruthy();
    expect(screen.queryByText(/audit trail kept/i)).toBeNull();
  });

  it("still says 'kept' when the trail was genuinely left alone", async () => {
    await runWith(200, { ...OK, auditDeleted: 0, auditRedacted: 0, auditDisposition: "keep" });

    await screen.findByText(/Erased every scan in acme/i);
    expect(screen.getByText(/audit trail kept/i)).toBeTruthy();
    expect(screen.getByText(/Audit rows \(trail kept\)/i)).toBeTruthy();
  });

  it("surfaces a 4xx/5xx refusal as an error and keeps the arming dialog", async () => {
    await runWith(503, { error: "Erasure requires a database." });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Erasure requires a database/i);
    expect(screen.getByText(/Erased, permanently/i)).toBeTruthy(); // still armed, nothing claimed erased
  });
});
