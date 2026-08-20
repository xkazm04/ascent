// Self-hosted deployment mode — the open-source-first promise, asserted in code.
//
// Ascent is AGPL software whose cloud sells OPERATION, not features. That claim is only true if a
// self-hosted deployment really does get every gated capability, unmetered scans, and unbounded
// retention. These tests are the enforcement: a future `planAllows*` gate added without the
// short-circuit fails here rather than quietly shipping an open-source build that is worse than the
// hosted one.
//
// The rest of the suite runs with ASCENT_SELF_HOSTED=0 pinned in vitest.config.js (it asserts CLOUD
// tier gating), so every test in this file sets the mode explicitly.

import { afterEach, describe, expect, it, vi } from "vitest";
import { selfHosted } from "@/lib/env";
import {
  isUnlimitedPlan,
  planAllowsByom,
  planAllowsMemory,
  planAllowsPdfExport,
  planAllowsSkillsLibrary,
  planAllowsWhiteLabel,
  resolveScanCharge,
  retentionCutoff,
  scanAllowance,
} from "@/lib/plans";
import { isMeteredScan } from "@/lib/entitlement";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Every plan gate, keyed by name so a failure names the capability rather than an index. */
const GATES = {
  byom: planAllowsByom,
  whiteLabel: planAllowsWhiteLabel,
  skillsLibrary: planAllowsSkillsLibrary,
  memory: planAllowsMemory,
  pdfExport: planAllowsPdfExport,
} satisfies Record<string, (plan: string | null | undefined) => boolean>;

describe("selfHosted()", () => {
  it("is true when ASCENT_SELF_HOSTED is explicitly on", () => {
    for (const v of ["1", "true", "TRUE", " true "]) {
      vi.stubEnv("ASCENT_SELF_HOSTED", v);
      expect(selfHosted(), v).toBe(true);
    }
  });

  it("is false when ASCENT_SELF_HOSTED is explicitly off, even with no billing configured", () => {
    vi.stubEnv("POLAR_ACCESS_TOKEN", "");
    for (const v of ["0", "false", "FALSE"]) {
      vi.stubEnv("ASCENT_SELF_HOSTED", v);
      expect(selfHosted(), v).toBe(false);
    }
  });

  // The whole point of the billing sniff: `git clone && npm run dev` configures nothing, and must
  // still get the full product rather than the Free tier's 5-scan allowance with the good parts off.
  it("defaults to self-hosted when unset and no Polar token is configured", () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "");
    vi.stubEnv("POLAR_ACCESS_TOKEN", "");
    expect(selfHosted()).toBe(true);
  });

  it("defaults to NOT self-hosted when unset but a Polar token is configured", () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "");
    vi.stubEnv("POLAR_ACCESS_TOKEN", "polar_at_live_xxx");
    expect(selfHosted()).toBe(false);
  });

  // A blank/whitespace token is not a configured price book; treating it as one would meter a
  // self-hoster who left the key in their .env with an empty value.
  it("treats a blank Polar token as unconfigured", () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "");
    vi.stubEnv("POLAR_ACCESS_TOKEN", "   ");
    expect(selfHosted()).toBe(true);
  });

  // An unrecognized value is not a third mode — it falls through to the sniff rather than throwing,
  // because a typo in a deployment flag must never take a self-hoster's whole app down.
  it("falls through to the billing sniff for an unrecognized value", () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "yes");
    vi.stubEnv("POLAR_ACCESS_TOKEN", "polar_at_live_xxx");
    expect(selfHosted()).toBe(false);
  });
});

describe("self-hosted: every plan gate is open", () => {
  it.each(Object.entries(GATES))("%s is allowed on the free tier", (_name, gate) => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    expect(gate("free")).toBe(true);
    expect(gate(null)).toBe(true);
    expect(gate("nonsense-plan")).toBe(true);
  });

  // The paired negative: with the same inputs in cloud mode the gates still discriminate, so these
  // tests are proving the short-circuit rather than proving the gates were never enforced.
  it.each(Object.entries(GATES))("%s is still gated in cloud mode", (_name, gate) => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "0");
    expect(gate("free")).toBe(false);
  });
});

describe("self-hosted: scans are unmetered", () => {
  it("reports every plan as unlimited and every allowance as unbounded", () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    expect(isUnlimitedPlan("free")).toBe(true);
    expect(scanAllowance("free")).toBeNull();
  });

  it("never charges a credit, even with zero balance and usage far past the allowance", () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    expect(resolveScanCharge({ plan: "free", usageThisMonth: 10_000, balance: 0 })).toBe("unlimited");
  });

  // The same input is the 402 moment on cloud — this is what the short-circuit is switching off.
  it("cloud mode still denies the same scan", () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "0");
    expect(resolveScanCharge({ plan: "free", usageThisMonth: 10_000, balance: 0 })).toBe("denied");
  });

  it("takes a metered org scan off the billing path entirely", () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    expect(isMeteredScan("acme", false)).toBe(false);
  });
});

describe("self-hosted: retention is the operator's own policy", () => {
  it("applies no read floor on any plan", () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    expect(retentionCutoff("free", Date.parse("2026-08-19T00:00:00Z"))).toBeNull();
  });

  it("cloud mode still clamps the free tier to its 30-day window", () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "0");
    const cutoff = retentionCutoff("free", Date.parse("2026-08-19T00:00:00Z"));
    expect(cutoff?.toISOString()).toBe("2026-07-20T00:00:00.000Z");
  });
});
