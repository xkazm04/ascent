// @vitest-environment jsdom
//
// Pins the Settings retention card: Save stays disabled until a dry-run preview of the current
// draft succeeds, a value below RETENTION_MIN_* is refused client-side, and save never sends a purge.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RetentionCard } from "./RetentionCard";
import type { OrgRetentionView } from "@/lib/db/retention-policy";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const INITIAL: OrgRetentionView = {
  stored: {
    retentionMaxScans: 10,
    retentionAuditDays: 30,
    retentionCompact: false,
    retentionDigestMonths: 0,
  },
  defaults: { maxScansPerRepo: 0, auditDays: 0, batchSize: 500 },
  effective: { maxScansPerRepo: 10, auditDays: 30, batchSize: 500 },
  compactDefault: false,
  digestMonthsDefault: 0,
  floors: { maxScansPerRepo: 5, auditDays: 7 },
};

const PREVIEW = {
  dryRun: true,
  preview: {
    scansDeleted: 4,
    dimensionsDeleted: 8,
    recommendationsDeleted: 1,
    auditDeleted: 2,
    digestsWouldWrite: 0,
  },
};

function previewBtn() {
  return screen.getByTestId("retention-preview") as HTMLButtonElement;
}
function saveBtn() {
  return screen.getByTestId("retention-save") as HTMLButtonElement;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  render(<RetentionCard slug="acme" initial={INITIAL} />);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RetentionCard — dry-run before save", () => {
  it("keeps Save disabled until a preview of the current draft succeeds", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => PREVIEW } as Response);

    expect(saveBtn().disabled).toBe(true);
    fireEvent.click(saveBtn());
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(previewBtn());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const previewBody = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(previewBody).toEqual({
      org: "acme",
      retentionMaxScans: 10,
      retentionAuditDays: 30,
      retentionCompact: false,
      retentionDigestMonths: 0,
      preview: true,
    });
    await screen.findByText("4");
    expect(saveBtn().disabled).toBe(false);

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, purged: false, stored: INITIAL.stored }),
    } as Response);
    fireEvent.click(saveBtn());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const saveBody = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, { body: string }])[1].body);
    expect(saveBody.preview).toBeUndefined();
    expect(saveBody.retentionMaxScans).toBe(10);
    expect(saveBody.retentionCompact).toBe(false);
    await screen.findByText(/Nothing was deleted/i);
  });

  it("refuses a sub-floor draft without fetching, and a later edit invalidates the preview", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => PREVIEW } as Response);

    fireEvent.change(screen.getByLabelText(/Max scans per repo/i), { target: { value: "1" } });
    expect(previewBtn().disabled).toBe(true);
    expect(saveBtn().disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/safety floor/i);
    fireEvent.click(previewBtn());
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Max scans per repo/i), { target: { value: "10" } });
    fireEvent.click(previewBtn());
    await waitFor(() => expect(saveBtn().disabled).toBe(false));

    fireEvent.change(screen.getByLabelText(/Audit log days/i), { target: { value: "90" } });
    expect(saveBtn().disabled).toBe(true);
  });
});
