// The Practices tab's degraded reads keep their fallback and are never silent.
import { describe, it, expect, vi } from "vitest";

const { reportHandledError } = vi.hoisted(() => ({ reportHandledError: vi.fn() }));
vi.mock("@/lib/api/respond", () => ({ reportHandledError }));

import { degraded } from "./practicesDegradedRead";

describe("degraded", () => {
  it("answers the fallback, logs with the tab's tag and reports the cause", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("db down");
    const rows = await Promise.reject<string[]>(boom).catch(degraded("acme", "shape rows", []));
    expect(rows).toEqual([]);
    expect(log).toHaveBeenCalledWith("[practices/tab] shape rows read failed for acme", boom);
    expect(reportHandledError).toHaveBeenCalledWith(boom, { message: "Practices tab: the shape rows read failed; the panel degraded." });
    log.mockRestore();
  });

  it("is inert on a resolved read", async () => {
    reportHandledError.mockClear();
    expect(await Promise.resolve(["a"]).catch(degraded("acme", "shape rows", []))).toEqual(["a"]);
    expect(reportHandledError).not.toHaveBeenCalled();
  });
});
