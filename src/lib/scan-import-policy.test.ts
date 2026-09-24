// The import job's scan policy survives the trip through the queue row's `reason` (backlog
// develop-2026-09-17 row 26). The worker decides token, inference and billing from this decode, so a
// lossy round trip would be a confused deputy or a surprise charge.

import { describe, it, expect } from "vitest";
import { decodeImportReason, importJobReason, type ImportJobPolicy } from "./scan-import-policy";

describe("import job reason codec", () => {
  const cases: ImportJobPolicy[] = [
    { token: "install", mock: false, funnel: false },
    { token: "ambient", mock: true, funnel: false },
    { token: "none", mock: false, funnel: true },
    { token: "none", mock: true, funnel: false },
  ];
  for (const policy of cases) {
    it(`round-trips ${JSON.stringify(policy)}`, () => {
      const reason = importJobReason(policy);
      expect(reason.startsWith("import:")).toBe(true);
      expect(decodeImportReason(reason)).toEqual(policy);
    });
  }

  it("guard: a bare legacy `import` and every non-import reason decode to null (the default path)", () => {
    expect(decodeImportReason("import")).toBeNull();
    expect(decodeImportReason("cadence")).toBeNull();
    expect(decodeImportReason("manual")).toBeNull();
    expect(decodeImportReason("webhook:push")).toBeNull();
  });

  it("an unrecognised token flag decodes to the least-privileged credential", () => {
    expect(decodeImportReason("import:root+mock")).toEqual({ token: "none", mock: true, funnel: false });
  });
});
