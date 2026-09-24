// @vitest-environment node
//
// The OpenAI panel's copy: a partial sync must READ partial wherever it is shown, and the covered
// span must name the last day actually pulled (a bucket's end is exclusive).

import { describe, expect, it } from "vitest";
import type { ProviderConnectionRow } from "@/lib/db/provider-credentials";
import { lastSyncLine, parseProjectIds, syncSummaryLine } from "./openaiSetupModel";

const row = (over: Partial<ProviderConnectionRow>): ProviderConnectionRow => ({
  provider: "openai",
  hasCredential: true,
  projectIds: [],
  lastSyncAt: "2026-09-24T10:05:00.000Z",
  lastSyncStatus: "complete",
  lastSyncDetail: null,
  lastSyncFrom: "2026-06-27T00:00:00.000Z",
  lastSyncThrough: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-24T10:05:00.000Z",
  ...over,
});

describe("lastSyncLine", () => {
  it("a complete sync names its span, last day inclusive", () => {
    expect(lastSyncLine(row({}))).toEqual({ text: "Last sync 2026-09-24: complete covering 2026-06-27 to 2026-09-24.", tone: "ok" });
  });

  it("a partial sync says PARTIAL and why, and is never styled as fine", () => {
    const line = lastSyncLine(row({ lastSyncStatus: "partial", lastSyncDetail: "OpenAI rate-limited the pull." }))!;
    expect(line.tone).toBe("warn");
    expect(line.text).toContain("PARTIAL");
    expect(line.text).toContain("OpenAI rate-limited the pull.");
    expect(line.text).not.toContain("complete covering");
  });

  it("nothing is shown before a first sync", () => {
    expect(lastSyncLine(row({ lastSyncAt: null, lastSyncStatus: null }))).toBeNull();
    expect(lastSyncLine(null)).toBeNull();
  });
});

describe("syncSummaryLine and parseProjectIds", () => {
  it("states days, records and dollars", () => {
    expect(syncSummaryLine({ days: 3, stored: 3, costCents: 137_900, from: "2026-08-01T00:00:00Z", through: "2026-08-04T00:00:00Z" })).toBe(
      "Synced 3 days of OpenAI cost (3 records stored): $1,379.00 covering 2026-08-01 to 2026-08-03.",
    );
  });

  it("splits commas, spaces and newlines", () => {
    expect(parseProjectIds(" proj_a, proj_b\nproj_c ,, ")).toEqual(["proj_a", "proj_b", "proj_c"]);
  });
});
