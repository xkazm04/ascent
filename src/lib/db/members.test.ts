// The role hierarchy that RBAC decisions hang on. Pure functions — the DB client is mocked away so
// importing the module never touches Prisma.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ getPrisma: vi.fn(), isDbConfigured: () => false }));

import { isOrgRole, roleAtLeast } from "./members";

describe("roleAtLeast", () => {
  it("orders owner > admin > member > viewer", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("admin", "admin")).toBe(true);
    expect(roleAtLeast("admin", "owner")).toBe(false);
    expect(roleAtLeast("member", "admin")).toBe(false);
    expect(roleAtLeast("viewer", "member")).toBe(false);
    expect(roleAtLeast("member", "viewer")).toBe(true);
  });

  it("treats a null/absent role as below everything", () => {
    expect(roleAtLeast(null, "viewer")).toBe(false);
    expect(roleAtLeast(undefined, "viewer")).toBe(false);
  });
});

describe("isOrgRole", () => {
  it("accepts the four valid roles and rejects anything else", () => {
    for (const r of ["owner", "admin", "member", "viewer"]) expect(isOrgRole(r)).toBe(true);
    expect(isOrgRole("guest")).toBe(false);
    expect(isOrgRole("")).toBe(false);
  });
});
