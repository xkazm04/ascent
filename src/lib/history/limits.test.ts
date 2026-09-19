// Pins the shared history depth + its user-facing note (G5-24): "All" must never be a silent
// truncation, and the chart's depth must equal the CSV export's depth.

import { describe, it, expect } from "vitest";
import { HISTORY_SCAN_CAP, historyCapNote, isHistoryCapped } from "@/lib/history/limits";

describe("history scan cap", () => {
  it("matches the DB reader's hard clamp (both views of one history read the same depth)", () => {
    expect(HISTORY_SCAN_CAP).toBe(200);
  });

  it("says nothing when the whole history fits under the cap", () => {
    expect(isHistoryCapped(0)).toBe(false);
    expect(isHistoryCapped(HISTORY_SCAN_CAP - 1)).toBe(false);
    expect(historyCapNote(59)).toBeNull();
  });

  it("LABELS the cap the moment it may be binding, naming the depth and the CSV parity", () => {
    expect(isHistoryCapped(HISTORY_SCAN_CAP)).toBe(true);
    const note = historyCapNote(HISTORY_SCAN_CAP);
    expect(note).toContain(String(HISTORY_SCAN_CAP));
    expect(note).toMatch(/All/);
    expect(note).toMatch(/CSV/);
  });
});
