import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The scan span's read doors (src/lib/scan-read-door.ts). Each must reach BOTH a log and telemetry:
// reportHandledError alone is inert without SENTRY_DSN, and a log alone never pages anyone.

const reportHandledError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/respond", () => ({ reportHandledError }));

import { degradeTo, reportDegradedRead, reportFailedRead } from "@/lib/scan-read-door";

beforeEach(() => {
  reportHandledError.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("scan read doors", () => {
  it("reportFailedRead logs an error and reports the error under the read's name", () => {
    const err = new Error("boom");
    reportFailedRead("report permalink: getSkillHistory", err);
    expect(console.error).toHaveBeenCalledWith("[read failed] report permalink: getSkillHistory:", err);
    expect(reportHandledError).toHaveBeenCalledWith(err, { message: "report permalink: getSkillHistory failed" });
  });

  it("reportDegradedRead logs a warning and reports the degrade", () => {
    const err = new Error("blip");
    reportDegradedRead("landing: getPublicScanGallery", err);
    expect(console.warn).toHaveBeenCalledWith("[read degraded] landing: getPublicScanGallery:", err);
    expect(reportHandledError).toHaveBeenCalledWith(err, { message: "landing: getPublicScanGallery failed (degraded)" });
  });

  it("degradeTo resolves the fallback through a rejected promise and reaches the door", async () => {
    const err = new Error("db down");
    const fallback: string[] = [];
    await expect(Promise.reject(err).catch(degradeTo("scan score input: decisionsForRepo", fallback))).resolves.toBe(fallback);
    expect(reportHandledError).toHaveBeenCalledWith(err, { message: "scan score input: decisionsForRepo failed (degraded)" });
  });

  it("degradeTo never fires on success", async () => {
    await expect(Promise.resolve("rows").catch(degradeTo("x", null))).resolves.toBe("rows");
    expect(reportHandledError).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
