// Pins the setup verdict a self-hosted /onboarding keys its whole first screen on. The cloud never
// says "unset" (its wizard creates the tenant); a self-host says it only when NOTHING points at a
// tenant — no declared local org, no GitHub App, no org rows beyond the public corpus.

import { describe, it, expect } from "vitest";
import { resolveFirstRunSetup } from "./first-run";

const base = { selfHosted: true, localOrg: null, appConfigured: false, tenantOrgs: 0 };

describe("resolveFirstRunSetup", () => {
  it("the cloud is always ready — the wizard is what creates its tenants", () => {
    expect(resolveFirstRunSetup({ ...base, selfHosted: false })).toBe("ready");
  });

  it("a fresh self-hosted clone with nothing configured is unset", () => {
    expect(resolveFirstRunSetup(base)).toBe("unset");
  });

  it("a declared local org (ASCENT_LOCAL_ORG) counts as set up", () => {
    expect(resolveFirstRunSetup({ ...base, localOrg: "local" })).toBe("ready");
  });

  it("a configured GitHub App counts as set up — installs can create the org", () => {
    expect(resolveFirstRunSetup({ ...base, appConfigured: true })).toBe("ready");
  });

  it("any tenant org beyond the public corpus counts as set up", () => {
    expect(resolveFirstRunSetup({ ...base, tenantOrgs: 1 })).toBe("ready");
  });
});
