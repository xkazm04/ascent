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

const RECEIPT = {
  lastPurge: { at: "2026-10-21T02:00:00.000Z", meta: { scansDeleted: 12, usageEventsDeleted: 3 } },
  lastSave: { at: "2026-10-03T08:00:00.000Z", meta: {} },
};

const FULL = (over: Record<string, number | null>) => ({
  scansDeleted: 4, dimensionsDeleted: 8, recommendationsDeleted: 1, recommendationEventsDeleted: 0, auditDeleted: 2,
  outcomesDeleted: 0, usageEventsDeleted: 100, conformanceReportsDeleted: 0, conformanceFindingsDeleted: 0,
  memoryCitationsDeleted: 0, controlObservationsDeleted: 0, digestsWritten: 0, scansCompacted: 0, digestsDeleted: 0,
  digestsWouldWrite: 0, ...over,
});

function respond(body: unknown) {
  vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => body } as Response);
}

function previewBtn() {
  return screen.getByTestId("retention-preview") as HTMLButtonElement;
}
function saveBtn() {
  return screen.getByTestId("retention-save") as HTMLButtonElement;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  render(<RetentionCard slug="acme" initial={INITIAL} receipt={RECEIPT} />);
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

describe("RetentionCard - what the edit adds, and the last purge", () => {
  it("shows every ledger as now, proposed and delta, including governance evidence", async () => {
    respond({ dryRun: true, baseline: FULL({}), preview: FULL({ controlObservationsDeleted: 40 }), errors: [] });
    fireEvent.click(previewBtn());
    const row = await screen.findByTestId("retention-row-controlObservationsDeleted");
    expect(row.textContent).toContain("Control observations");
    expect(row.textContent).toContain("+40");
    expect(screen.getByTestId("retention-row-usageEventsDeleted").textContent).toContain("Usage events");
    expect(screen.getByTestId("retention-row-memoryCitationsDeleted")).toBeTruthy();
    expect(saveBtn().disabled).toBe(false);
  });

  it("renders unknown and keeps Save disabled when the response carries no preview", async () => {
    respond({ dryRun: true, errors: [] });
    fireEvent.click(previewBtn());
    await screen.findByText(/could not be counted/i);
    expect(screen.queryByTestId("retention-row-scansDeleted")).toBeNull();
    expect(saveBtn().disabled).toBe(true);
  });

  it("shows a null digest count as unknown, never 0", async () => {
    respond({ dryRun: true, baseline: FULL({}), preview: FULL({ digestsWouldWrite: null }), errors: [] });
    fireEvent.click(previewBtn());
    const row = await screen.findByTestId("retention-row-digestsWouldWrite");
    expect(row.textContent).toMatch(/unknown/);
  });

  it("surfaces the preview errors in an alert instead of dropping them", async () => {
    respond({ dryRun: true, baseline: FULL({}), preview: FULL({}), errors: ["acme: usage sweep failed"] });
    fireEvent.click(previewBtn());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("acme: usage sweep failed"));
  });

  it("shows the last purge receipt for this org, with no em dash in the new copy", async () => {
    const strip = screen.getByTestId("retention-receipt");
    expect(strip.textContent).toContain("Last purge removed 15 rows on 2026-10-21");
    respond({ dryRun: true, baseline: FULL({}), preview: FULL({ controlObservationsDeleted: 40 }), errors: ["x"] });
    fireEvent.click(previewBtn());
    const panel = await screen.findByTestId("retention-preview-panel");
    expect(`${strip.textContent} ${panel.textContent}`).not.toContain("\u2014");
  });
});
