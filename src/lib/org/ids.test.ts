import { describe, expect, it } from "vitest";
import { asOrgSlug } from "@/lib/org/ids";

describe("org slug canonicalization", () => {
  it("trims and lower-cases a slug, because org rows are persisted lower-cased", () => {
    expect(asOrgSlug("  AcMe  ")).toBe("acme");
  });

  it("is idempotent, so a caller cannot mint a slug that skipped canonicalization", () => {
    expect(asOrgSlug(asOrgSlug("ACME"))).toBe("acme");
  });
});
