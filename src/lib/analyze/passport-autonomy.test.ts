// Tests for the per-repo autonomy tier (W1b). deriveAutonomyTier is pure over (passport, governance),
// so these drive synthetic passports to pin: the T0→T3 ladder predicates, the cumulative unlock
// checklists, the token-honesty cap (governance null ⇒ ≤ T1, named in `missing`), the 0.3.0 read-time
// migration (old rows get tiers WITHOUT rescans, sandbox/hooks stay unknown — never fabricated), and
// the buildPassport integration incl. the new sandbox/hooks detectors.

import { describe, it, expect } from "vitest";
import {
  PASSPORT_VERSION,
  TOKENLESS_MISSING,
  buildPassport,
  deriveAutonomyForStored,
  deriveAutonomyTier,
  parsePassportJson,
  upgradePassport,
} from "@/lib/analyze/passport";
import type { AppPassport, Governance, RepoMeta, RepoSnapshot, ScanReport, TechStack } from "@/lib/types";

// ── synthetic passport factory (direct-unit half) ─────────────────────────────────────────────────
interface Knobs {
  agentInstructions?: string[];
  selfVerifyTest?: boolean;
  testsLevel?: AppPassport["productionReadiness"]["tests"]["level"];
  ciLevel?: AppPassport["productionReadiness"]["ci"]["level"];
  sandbox?: boolean;
  hooks?: boolean;
  aiInWorkflow?: boolean;
  evals?: "none" | "partial" | "full";
  migrations?: "none" | "scripted" | "versioned";
  source?: string;
  passportVersion?: string;
}

function pp(k: Knobs = {}): AppPassport {
  return {
    passport: "app-passport",
    passportVersion: k.passportVersion ?? PASSPORT_VERSION,
    generatedAt: "2026-08-12",
    generatedBy: "ascent-scan",
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
        evals: k.evals ?? "none",
        skills: "none",
        ...(k.sandbox !== undefined ? { sandbox: k.sandbox } : {}),
        ...(k.hooks !== undefined ? { hooks: k.hooks } : {}),
      },
      selfVerify: { build: true, test: k.selfVerifyTest ?? false, lint: false, typecheck: false },
      aiInWorkflow: k.aiInWorkflow ?? false,
      blockers: [],
    },
    productionReadiness: {
      band: "beta",
      score: 50,
      ci: { level: k.ciLevel ?? "none", provider: null, gates: [] },
      tests: { level: k.testsLevel ?? "none", coveragePct: null, frameworks: [], criticalPathCovered: false },
      security: { level: "none", tools: [] },
      observability: { level: "none" },
      delivery: { migrations: k.migrations ?? "none", iac: false, rollback: false },
      blockers: [],
    },
    links: {},
    evidence: { confidence: 0.8, source: k.source ?? "static-scan", files: [] },
  };
}

const gov = (over: Partial<Governance> = {}): Governance => ({
  defaultBranch: "main", protected: true, requiresPullRequest: true, requiredApprovals: 1, requiresCodeOwnerReview: false,
  requiresStatusChecks: true, requiresSignatures: false, linearHistory: false, ruleCount: 3, readable: true, ...over,
});

const T1_KNOBS: Knobs = { agentInstructions: ["CLAUDE.md"], selfVerifyTest: true, testsLevel: "partial" };
const T2_KNOBS: Knobs = { ...T1_KNOBS, testsLevel: "substantial", ciLevel: "gated", hooks: true, sandbox: false };
const T3_KNOBS: Knobs = { ...T2_KNOBS, aiInWorkflow: true, evals: "partial", migrations: "versioned" };

// ── the ladder ─────────────────────────────────────────────────────────────────────────────────────
describe("deriveAutonomyTier — T0→T3 ladder predicates", () => {
  it("T0 is the default: a bare passport grants nothing", () => {
    const a = deriveAutonomyTier(pp(), gov());
    expect(a.tier).toBe("T0");
    expect(a.unlocks.map((u) => u.tier)).toEqual(["T1", "T2", "T3"]);
  });

  it("T1 = agent instructions + one-command test + tests ≥ partial", () => {
    expect(deriveAutonomyTier(pp(T1_KNOBS), gov()).tier).toBe("T1");
  });

  it("each unmet T1 predicate names itself in the T1 unlock checklist", () => {
    const missingAll = deriveAutonomyTier(pp(), gov()).unlocks.find((u) => u.tier === "T1")!.missing;
    expect(missingAll.some((m) => /CLAUDE\.md \/ AGENTS\.md/.test(m))).toBe(true);
    expect(missingAll.some((m) => /one-command test entry point/.test(m))).toBe(true);
    expect(missingAll.some((m) => /Test suite is none/.test(m))).toBe(true);

    // A single failing predicate leaves exactly one item.
    const one = deriveAutonomyTier(pp({ ...T1_KNOBS, selfVerifyTest: false }), gov());
    expect(one.tier).toBe("T0");
    expect(one.unlocks.find((u) => u.tier === "T1")!.missing).toHaveLength(1);
  });

  it("T2 = T1 + gated CI + substantial tests + (hooks OR sandbox)", () => {
    expect(deriveAutonomyTier(pp(T2_KNOBS), gov()).tier).toBe("T2");
    // sandbox alone also satisfies the guardrail leg
    expect(deriveAutonomyTier(pp({ ...T2_KNOBS, hooks: false, sandbox: true }), gov()).tier).toBe("T2");
    // neither ⇒ held at T1 with the guardrail line in the T2 checklist
    const held = deriveAutonomyTier(pp({ ...T2_KNOBS, hooks: false, sandbox: false }), gov());
    expect(held.tier).toBe("T1");
    expect(held.unlocks.find((u) => u.tier === "T2")!.missing).toEqual([
      expect.stringMatching(/No guardrail hooks .* no reproducible sandbox/),
    ]);
  });

  it("ci levels above gated (delivery/progressive) also satisfy the T2 CI predicate", () => {
    expect(deriveAutonomyTier(pp({ ...T2_KNOBS, ciLevel: "delivery" }), gov()).tier).toBe("T2");
    expect(deriveAutonomyTier(pp({ ...T2_KNOBS, ciLevel: "checks" }), gov()).tier).toBe("T1");
  });

  it("T3 = T2 + aiInWorkflow + evals ≠ none + versioned migrations, and unlocks empties", () => {
    const a = deriveAutonomyTier(pp(T3_KNOBS), gov());
    expect(a.tier).toBe("T3");
    expect(a.unlocks).toEqual([]);
  });

  it("each unmet T3 predicate names itself", () => {
    const missing = deriveAutonomyTier(pp(T2_KNOBS), gov()).unlocks.find((u) => u.tier === "T3")!.missing;
    expect(missing.some((m) => /No evidence AI is used/.test(m))).toBe(true);
    expect(missing.some((m) => /No eval \/ golden-test harness/.test(m))).toBe(true);
    expect(missing.some((m) => /Migrations are none/.test(m))).toBe(true);
  });

  it("unlock checklists are CUMULATIVE — a T2 list carries still-unmet T1 items", () => {
    const a = deriveAutonomyTier(pp({ ...T2_KNOBS, selfVerifyTest: false }), gov());
    expect(a.tier).toBe("T0");
    expect(a.unlocks.find((u) => u.tier === "T2")!.missing.some((m) => /one-command test entry point/.test(m))).toBe(true);
  });

  it("records the raw inputs so the grant is auditable", () => {
    const a = deriveAutonomyTier(pp(T2_KNOBS), gov());
    expect(a.inputs).toEqual({
      agentInstructions: true,
      selfVerifyTest: true,
      testsLevel: "substantial",
      ciLevel: "gated",
      sandbox: false,
      hooks: true,
      aiInWorkflow: false,
      evals: "none",
      migrations: "none",
      enforcementVisible: true,
    });
  });
});

// ── token honesty ──────────────────────────────────────────────────────────────────────────────────
describe("deriveAutonomyTier — tokenless cap (governance null)", () => {
  it("caps at T1 and names the token limitation ahead of the T2/T3 checklists", () => {
    // Everything else T3-worthy — but no enforcement visibility. (A real tokenless build could never
    // even write ci "gated"; forcing it here isolates the cap itself.)
    const a = deriveAutonomyTier(pp(T3_KNOBS), null);
    expect(a.tier).toBe("T1");
    expect(a.inputs.enforcementVisible).toBe(false);
    expect(a.unlocks.find((u) => u.tier === "T2")!.missing[0]).toBe(TOKENLESS_MISSING);
    expect(a.unlocks.find((u) => u.tier === "T3")!.missing[0]).toBe(TOKENLESS_MISSING);
  });

  it("does not touch the T1 grant — tests/docs delegation never needed enforcement visibility", () => {
    expect(deriveAutonomyTier(pp(T1_KNOBS), null).tier).toBe("T1");
    expect(deriveAutonomyTier(pp(), null).unlocks.find((u) => u.tier === "T1")!.missing).not.toContain(TOKENLESS_MISSING);
  });
});

// ── migration derivation (0.x → 0.3.0 read-time) ──────────────────────────────────────────────────
describe("upgradePassport — 0.3.0 autonomy lift (old rows get tiers WITHOUT rescans)", () => {
  it("PASSPORT_VERSION bumped to 0.3.0 (version-bump discipline)", () => {
    expect(PASSPORT_VERSION).toBe("0.3.0");
  });

  it("derives autonomy for a stored 0.2.0 row and tags migratedFrom 0.2.0", () => {
    const stored = pp({ ...T1_KNOBS, passportVersion: "0.2.0" });
    delete (stored.automationReadiness.artifacts as { sandbox?: boolean }).sandbox;
    delete (stored.automationReadiness.artifacts as { hooks?: boolean }).hooks;
    const up = upgradePassport(stored);
    expect(up.passportVersion).toBe(PASSPORT_VERSION);
    expect(up.migratedFrom).toBe("0.2.0");
    expect(up.autonomy?.tier).toBe("T1");
    expect(up.evidence.notes?.some((n) => /re-scan to detect them/i.test(n))).toBe(true);
    // 0.2.0 rows never carried the boolean-artifact shape, so the 0.1.0 note must NOT appear.
    expect(up.evidence.notes?.some((n) => /0\.1\.0/.test(n))).toBe(false);
  });

  it("NEVER fabricates sandbox/hooks on a migrated row — unknown (null inputs), named in `missing`", () => {
    const stored = pp({ ...T2_KNOBS, passportVersion: "0.2.0" });
    delete (stored.automationReadiness.artifacts as { sandbox?: boolean }).sandbox;
    delete (stored.automationReadiness.artifacts as { hooks?: boolean }).hooks;
    const up = upgradePassport(stored);
    // The old scan never looked: no invented booleans on the artifacts block...
    expect("sandbox" in up.automationReadiness.artifacts).toBe(false);
    expect("hooks" in up.automationReadiness.artifacts).toBe(false);
    // ...inputs read unknown, the tier stays conservative (T1, not T2)...
    expect(up.autonomy?.inputs.sandbox).toBeNull();
    expect(up.autonomy?.inputs.hooks).toBeNull();
    expect(up.autonomy?.tier).toBe("T1");
    // ...and the checklist names the re-scan, not a missing artifact the scan can't attest to.
    expect(up.autonomy?.unlocks.find((u) => u.tier === "T2")!.missing).toEqual([
      expect.stringMatching(/not assessed by this pre-0\.3\.0 scan/),
    ]);
  });

  it("a stored TOKENLESS row (evidence.source marker) stays capped at T1", () => {
    const stored = pp({ ...T1_KNOBS, passportVersion: "0.2.0", source: "static-scan (no branch-protection visibility)" });
    const up = upgradePassport(stored);
    expect(up.autonomy?.inputs.enforcementVisible).toBe(false);
    expect(up.autonomy?.unlocks.find((u) => u.tier === "T2")!.missing[0]).toBe(TOKENLESS_MISSING);
  });

  it("a 0.1.0 row gets BOTH lifts: graded artifacts and an autonomy tier", () => {
    const v010 = pp({ passportVersion: "0.1.0" });
    (v010.automationReadiness.artifacts as unknown as { memory: unknown; skills: unknown }).memory = true;
    (v010.automationReadiness.artifacts as unknown as { memory: unknown; skills: unknown }).skills = false;
    const up = upgradePassport(v010);
    expect(up.automationReadiness.artifacts.memory).toBe("adhoc");
    expect(up.autonomy?.tier).toBe("T0");
    expect(up.migratedFrom).toBe("0.1.0");
  });

  it("deriveAutonomyForStored survives a partial legacy blob (defaults to floors, T0)", () => {
    const partial = {
      passport: "app-passport",
      identity: { name: "web" },
      automationReadiness: { level: "L3", artifacts: { memory: true, skills: false } },
      productionReadiness: { band: "beta" },
    } as unknown as AppPassport;
    const a = deriveAutonomyForStored(partial);
    expect(a.tier).toBe("T0");
    expect(a.inputs.testsLevel).toBe("none");
    expect(a.inputs.sandbox).toBeNull();
  });

  it("is idempotent and a no-op (same reference) on a current passport", () => {
    const current = pp(T1_KNOBS);
    current.autonomy = deriveAutonomyTier(current, gov());
    expect(upgradePassport(current)).toBe(current);
  });
});

// ── buildPassport integration (fresh scans) ────────────────────────────────────────────────────────
function meta(over: Partial<RepoMeta> = {}): RepoMeta {
  return { owner: "acme", name: "web", url: "https://github.com/acme/web", stars: 0, forks: 0, defaultBranch: "main", primaryLanguage: "TypeScript", ...over };
}
type Snap = Pick<RepoSnapshot, "meta" | "tree" | "files" | "commits" | "coverage">;
function snap(opts: { tree?: string[]; files?: Record<string, string>; commits?: string[] }): Snap {
  return {
    meta: meta(),
    tree: (opts.tree ?? []).map((p) => ({ path: p, type: "blob" as const })),
    files: Object.entries(opts.files ?? {}).map(([path, content]) => ({ path, content, bytes: content.length })),
    commits: (opts.commits ?? []).map((message) => ({ message })),
    coverage: 1,
  };
}
const techStack: TechStack = { languages: ["TypeScript"], frameworks: ["Next.js"], roles: ["frontend"], backendLanguage: "Node", confidence: 0.8 };
function report(over: Partial<ScanReport> = {}): ScanReport {
  return {
    repo: meta(),
    overallScore: 72,
    level: { id: "L4", name: "Integrated", band: [65, 84], tagline: "", description: "" },
    archetype: "team",
    confidence: 0.8,
    dimensions: [{ id: "D2", score: 75 }] as unknown as ScanReport["dimensions"],
    techStack,
    governance: gov(),
    prStats: null,
    scannedAt: "2026-08-12T12:00:00Z",
    ...over,
  } as unknown as ScanReport;
}
const PKG = JSON.stringify({
  scripts: { build: "next build", test: "vitest run", lint: "eslint .", typecheck: "tsc --noEmit" },
  dependencies: { next: "16", "@prisma/client": "6" },
  devDependencies: { vitest: "4", prisma: "6" },
});
const T3_TREE = [
  "package.json", "claude.md", "prisma/schema.prisma", "prisma/migrations/0_init/migration.sql",
  ".github/workflows/ci.yml", ".husky/pre-commit", "evals/quality.yaml",
];
const T3_FILES = {
  "package.json": PKG,
  "prisma/schema.prisma": 'datasource db {\n  provider = "postgresql"\n}',
  ".github/workflows/ci.yml": "jobs:\n  ci:\n    steps:\n      - run: npm test\n      - run: npm run lint",
};
const AI_COMMIT = "feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>";

describe("buildPassport — sandbox/hooks detectors + persisted autonomy block", () => {
  it("detects sandbox from devcontainer / Dockerfile / nix / .tool-versions", () => {
    const has = (tree: string[]) =>
      buildPassport(report(), snap({ tree: ["package.json", ...tree], files: { "package.json": PKG } })).automationReadiness.artifacts.sandbox;
    expect(has([])).toBe(false);
    expect(has([".devcontainer/devcontainer.json"])).toBe(true);
    expect(has(["Dockerfile"])).toBe(true);
    expect(has(["flake.nix"])).toBe(true);
    expect(has([".tool-versions"])).toBe(true);
  });

  it("detects hooks from .husky / lefthook / pre-commit configs", () => {
    const has = (tree: string[], files: Record<string, string> = {}) =>
      buildPassport(report(), snap({ tree: ["package.json", ...tree], files: { "package.json": PKG, ...files } })).automationReadiness.artifacts.hooks;
    expect(has([])).toBe(false);
    expect(has([".husky/pre-commit"])).toBe(true);
    expect(has(["lefthook.yml"])).toBe(true);
    expect(has([".pre-commit-config.yaml"])).toBe(true);
  });

  it("credits a .claude/settings.json hooks block only when the CONTENT was fetched", () => {
    const has = (files: Record<string, string>) =>
      buildPassport(report(), snap({ tree: ["package.json", ".claude/settings.json"], files: { "package.json": PKG, ...files } })).automationReadiness.artifacts.hooks;
    expect(has({})).toBe(false); // tree presence alone proves nothing about hooks
    expect(has({ ".claude/settings.json": '{ "hooks": { "Stop": [] } }' })).toBe(true);
    expect(has({ ".claude/settings.json": '{ "permissions": {} }' })).toBe(false);
  });

  it("persists an autonomy block that climbs the ladder end-to-end (fresh token scan → T3)", () => {
    const pp3 = buildPassport(report(), snap({ tree: T3_TREE, files: T3_FILES, commits: [AI_COMMIT] }));
    expect(pp3.autonomy?.tier).toBe("T3");
    expect(pp3.autonomy?.unlocks).toEqual([]);
    expect(pp3.autonomy?.inputs.hooks).toBe(true);
  });

  it("the SAME repo scanned tokenless caps at T1 and says why", () => {
    const pp1 = buildPassport(report({ governance: null }), snap({ tree: T3_TREE, files: T3_FILES, commits: [AI_COMMIT] }));
    expect(pp1.autonomy?.tier).toBe("T1");
    expect(pp1.autonomy?.unlocks.find((u) => u.tier === "T2")!.missing).toContain(TOKENLESS_MISSING);
  });

  it("round-trips migrated through parsePassportJson unchanged (fresh 0.3.0 blob is a no-op)", () => {
    const fresh = buildPassport(report(), snap({ tree: T3_TREE, files: T3_FILES, commits: [AI_COMMIT] }));
    expect(parsePassportJson(JSON.stringify(fresh))).toEqual(fresh);
    expect(parsePassportJson(JSON.stringify(fresh))?.migratedFrom).toBeUndefined();
  });
});
