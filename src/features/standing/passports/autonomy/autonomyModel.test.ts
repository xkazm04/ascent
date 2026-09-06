// Direction 8 — ONE VERDICT. `deriveAutonomy` used to run a private five-gate ladder to a tier, then
// overwrite that tier with the persisted one while KEEPING the private ladder's blocking list and
// progress meter — so the stamp and the "what would raise this" line came from two different ladders
// and could contradict each other. These pin that the tier, the blocking conditions and the progress
// all come from `deriveAutonomyForStored` (the resolver src/lib/db/org-admission.ts seeds from), and
// that LADDER_PREDICATES — the progress denominator — matches the real predicate count upstream.

import { describe, it, expect } from "vitest";
import { deriveAutonomyForStored, TOKENLESS_MISSING } from "@/lib/analyze/passport";
import type { AppPassport } from "@/lib/types";
import { LADDER_PREDICATES, deriveAutonomy } from "./autonomyModel";

interface Knobs {
  agentInstructions?: string[];
  selfVerifyTest?: boolean;
  testsLevel?: AppPassport["productionReadiness"]["tests"]["level"];
  ciLevel?: AppPassport["productionReadiness"]["ci"]["level"];
  sandbox?: boolean;
  hooks?: boolean;
  source?: string;
  autonomyTier?: "T0" | "T1" | "T2" | "T3";
}

function pp(k: Knobs = {}): AppPassport {
  const base = {
    passport: "app-passport",
    passportVersion: "0.4.0",
    generatedAt: "2026-08-12",
    identity: { name: "web", slug: "web", purpose: "p", archetype: "team", visibility: "public", license: null },
    stack: {
      languages: [],
      frameworks: [],
      persistence: [],
      monitoring: { errorTracking: null, logs: null, metrics: null, tracing: null, uptime: null },
      hosting: null,
      integrations: [],
    },
    automationReadiness: {
      level: "L3",
      score: 50,
      artifacts: {
        agentInstructions: k.agentInstructions ?? [],
        contextGraph: "none",
        memory: "none",
        manifest: false,
        evals: "none",
        skills: "none",
        ...(k.sandbox !== undefined ? { sandbox: k.sandbox } : {}),
        ...(k.hooks !== undefined ? { hooks: k.hooks } : {}),
      },
      selfVerify: { build: true, test: k.selfVerifyTest ?? false, lint: false, typecheck: false },
      aiInWorkflow: false,
      blockers: [],
    },
    productionReadiness: {
      band: "beta",
      score: 50,
      ci: { level: k.ciLevel ?? "none", provider: null, gates: [] },
      tests: { level: k.testsLevel ?? "none", coveragePct: null, frameworks: [], criticalPathCovered: false },
      security: { level: "none", tools: [] },
      observability: { level: "none" },
      delivery: { migrations: "none", iac: false, rollback: false },
      blockers: [],
    },
    links: {},
    evidence: { confidence: 0.8, source: k.source ?? "static-scan", files: [] },
  } as unknown as AppPassport;
  if (k.autonomyTier) (base as { autonomy?: unknown }).autonomy = { tier: k.autonomyTier, unlocks: [], inputs: {} };
  return base;
}

const T1: Knobs = { agentInstructions: ["CLAUDE.md"], selfVerifyTest: true, testsLevel: "partial" };
const T2: Knobs = { ...T1, testsLevel: "substantial", ciLevel: "gated", hooks: true };

const derive = (k: Knobs = {}) => deriveAutonomy({ fullName: "acme/web", name: "web", passport: pp(k) });

describe("deriveAutonomy — one ladder", () => {
  it("takes the tier from the shared resolver, not from the gate scores", () => {
    for (const k of [{}, T1, T2]) {
      const shared = deriveAutonomyForStored(pp(k));
      expect(`T${derive(k).tier}`).toBe(shared.tier);
    }
  });

  it("blocking is the shared resolver's OWN unmet conditions for the next tier", () => {
    const a = derive(T1);
    expect(a.tier).toBe(1);
    expect(a.nextTier).toBe(2);
    const shared = deriveAutonomyForStored(pp(T1)).unlocks.find((u) => u.tier === "T2")!.missing;
    expect(a.blocking).toEqual(shared);
    // Sentences, not gate objects — the surface renders the ladder's own words.
    expect(a.blocking.every((b) => typeof b === "string")).toBe(true);
  });

  it("a persisted autonomy block does NOT let the tier disagree with the conditions listed", () => {
    // The old bug: the stamp was overwritten from pp.autonomy while blocking came from the private
    // ladder. A LYING persisted block must not move the verdict away from what the conditions say.
    const a = derive({ ...T1, autonomyTier: "T3" });
    expect(a.tier).toBe(1);
    expect(a.blocking.length).toBeGreaterThan(0);
  });

  it("a repo at the top of the ladder has no next tier, no conditions and 100% progress", () => {
    const top = deriveAutonomy({
      fullName: "acme/web",
      name: "web",
      passport: pp(T2),
    });
    if (top.nextTier === null) {
      expect(top.blocking).toEqual([]);
      expect(top.nextProgress).toBe(100);
    } else {
      // T2 with no AI-in-workflow/evals/migrations still climbs no further; assert the meter is honest.
      expect(top.nextProgress).toBeLessThan(100);
    }
  });

  it("nextProgress is the share of the next tier's predicates already met", () => {
    // T0 with nothing: all three T1 predicates unmet ⇒ 0%.
    expect(derive().nextProgress).toBe(0);
    // T0 with two of three T1 predicates met ⇒ 1 of 3 unmet ⇒ 67%.
    const partial = derive({ agentInstructions: ["CLAUDE.md"], selfVerifyTest: true });
    expect(partial.tier).toBe(0);
    expect(partial.nextProgress).toBe(67);
  });

  it("the tokenless VISIBILITY caveat does not count against the meter", () => {
    const tokenless = { ...T1, source: "static-scan · no branch-protection visibility" };
    const a = derive(tokenless);
    expect(a.blocking[0]).toBe(TOKENLESS_MISSING);
    // Only the real unmet predicates move the number.
    const real = a.blocking.filter((m) => m !== TOKENLESS_MISSING).length;
    expect(a.nextProgress).toBe(Math.round((100 * (LADDER_PREDICATES[2] - real)) / LADDER_PREDICATES[2]));
  });

  it("still renders all five evidence gates, in order", () => {
    expect(derive().gates.map((g) => g.id)).toEqual(["tests", "ci", "sandbox", "context", "hooks"]);
  });
});

describe("LADDER_PREDICATES", () => {
  it("matches the resolver's real cumulative predicate counts (a floor passport fails everything)", () => {
    const floor = deriveAutonomyForStored(pp());
    for (const t of [1, 2, 3] as const) {
      const missing = floor.unlocks.find((u) => u.tier === `T${t}`)!.missing.filter((m) => m !== TOKENLESS_MISSING);
      expect(missing.length).toBe(LADDER_PREDICATES[t]);
    }
  });
});
