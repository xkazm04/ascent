import { describe, expect, it } from "vitest";
import { emptyTenantEnabled } from "./empty-gate";

describe("emptyTenantEnabled", () => {
  it("accepts exactly the documented truthy tokens", () => {
    for (const v of ["1", "true", "yes", "on"]) {
      expect(emptyTenantEnabled({ ASCENT_EMPTY: v }), v).toBe(true);
    }
  });

  it("is case-insensitive and trims surrounding whitespace", () => {
    for (const v of ["TRUE", "True", "YES", "On", " 1 ", "\ttrue\n", " ON"]) {
      expect(emptyTenantEnabled({ ASCENT_EMPTY: v }), JSON.stringify(v)).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const v of ["0", "false", "no", "off", "", " ", "2", "enabled", "y", "t"]) {
      expect(emptyTenantEnabled({ ASCENT_EMPTY: v }), JSON.stringify(v)).toBe(false);
    }
  });

  it("is false when the var is unset", () => {
    expect(emptyTenantEnabled({})).toBe(false);
    expect(emptyTenantEnabled({ ASCENT_EMPTY: undefined })).toBe(false);
  });

  it("reads only the env bag it is handed (pure — no process.env leak)", () => {
    // Even if the real process env had the flag on, an explicit empty bag must win.
    expect(emptyTenantEnabled({ OTHER: "1" })).toBe(false);
  });
});
