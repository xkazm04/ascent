// Tests for the App Readiness Passport builder (P1). buildPassport is pure over (report, snapshot), so
// these drive synthetic reports/snapshots to pin: the named-stack/persistence/integration detection,
// the maturity-ladder automation axis, the derived production band, determinism, and — the load-bearing
// one — the PRESENT-vs-ENFORCED honesty cap: a tokenless scan (governance null) must NOT claim a "gated"
// CI/security rung it couldn't observe, and must say so in evidence/blockers.

import { describe, it, expect } from "vitest";
import {
  PASSPORT_VERSION,
  applyPassportOverrides,
  buildPassport,
  isDeclinablePath,
  parseDeclined,
  parsePassportJson,
  parsePassportOverrides,
  upgradePassport,
} from "@/lib/analyze/passport";
import type { AppPassport, Governance, RepoMeta, RepoSnapshot, ScanReport, TechStack } from "@/lib/types";

function meta(over: Partial<RepoMeta> = {}): RepoMeta {
  return { owner: "acme", name: "web", url: "https://github.com/acme/web", stars: 0, forks: 0, defaultBranch: "main", primaryLanguage: "TypeScript", ...over };
}
type Snap = Pick<RepoSnapshot, "meta" | "tree" | "files" | "commits" | "coverage">;
function snap(opts: { metaOver?: Partial<RepoMeta>; tree?: string[]; files?: Record<string, string>; commits?: string[]; coverage?: number }): Snap {
  return {
    meta: meta(opts.metaOver),
    tree: (opts.tree ?? []).map((p) => ({ path: p, type: "blob" as const })),
    files: Object.entries(opts.files ?? {}).map(([path, content]) => ({ path, content, bytes: content.length })),
    commits: (opts.commits ?? []).map((message) => ({ message })),
    coverage: opts.coverage ?? 1,
  };
}
const gov = (over: Partial<Governance> = {}): Governance => ({
  defaultBranch: "main", protected: true, requiresPullRequest: true, requiredApprovals: 1, requiresCodeOwnerReview: false,
  requiresStatusChecks: true, requiresSignatures: false, linearHistory: false, ruleCount: 3, readable: true, ...over,
});
const techStack: TechStack = { languages: ["TypeScript"], frameworks: ["Next.js", "React"], roles: ["frontend", "backend"], backendLanguage: "Node", confidence: 0.8 };

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
    scannedAt: "2026-06-22T12:00:00Z",
    ...over,
  } as unknown as ScanReport;
}

const PKG = JSON.stringify({
  version: "1.2.0",
  engines: { node: ">=20" },
  scripts: { build: "next build", test: "vitest run", lint: "eslint .", typecheck: "tsc --noEmit" },
  dependencies: { next: "16", react: "19", "@prisma/client": "6", "@aws-sdk/client-bedrock-runtime": "3", "@sentry/node": "8" },
  devDependencies: { vitest: "4", "@playwright/test": "1", prisma: "6" },
});

const fullSnap = () =>
  snap({
    tree: ["package.json", "claude.md", "agents.md", "context-map.json", "prisma/schema.prisma", "prisma/migrations/0_init/migration.sql", ".github/workflows/ci.yml", "security.md", "src/app/api/health/route.ts"],
    files: {
      "package.json": PKG,
      "prisma/schema.prisma": 'datasource db {\n  provider = "postgresql"\n}',
      ".github/workflows/ci.yml": "jobs:\n  ci:\n    steps:\n      - run: npm test\n      - run: npm run lint",
    },
    commits: ["feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>"],
  });

describe("buildPassport — golden output (full token scan)", () => {
  const pp = buildPassport(report(), fullSnap());

  it("names the stack: persistence (prisma/versioned), integrations (Bedrock=llm), monitoring (sentry)", () => {
    expect(pp.stack.persistence[0]).toMatchObject({ kind: "relational", engine: "postgresql", orm: "prisma", migrations: "versioned" });
    expect(pp.stack.integrations).toEqual(expect.arrayContaining([{ name: "AWS Bedrock", kind: "llm", direction: "outbound" }]));
    expect(pp.stack.monitoring.errorTracking).toBe("sentry");
    expect(pp.stack.languages[0]).toEqual({ name: "TypeScript", primary: true });
    expect(pp.stack.packageManager).toBe("npm");
    expect(pp.stack.runtime).toBe("node>=20");
  });

  it("automation axis = the L1–L5 maturity ladder, with artifact/selfVerify evidence", () => {
    expect(pp.automationReadiness.level).toBe("L4");
    expect(pp.automationReadiness.score).toBe(72);
    expect(pp.automationReadiness.artifacts.agentInstructions).toEqual(expect.arrayContaining(["CLAUDE.md", "AGENTS.md"]));
    expect(pp.automationReadiness.artifacts.contextGraph).toBe("full");
    expect(pp.automationReadiness.selfVerify).toEqual({ build: true, test: true, lint: true, typecheck: true });
    expect(pp.automationReadiness.aiInWorkflow).toBe(true); // commit co-author trailer
    // 0.2.0: graded ladders, not booleans. This snapshot carries neither artifact.
    expect(pp.automationReadiness.artifacts.memory).toBe("none");
    expect(pp.automationReadiness.artifacts.skills).toBe("none");
    expect(pp.passportVersion).toBe(PASSPORT_VERSION);
    expect(pp.migratedFrom).toBeUndefined(); // freshly assessed, never a migration floor
  });

  it("production axis: CI gated (enforced), tests substantial, derived band", () => {
    expect(pp.productionReadiness.ci.level).toBe("gated"); // governance enforced + checks present
    expect(pp.productionReadiness.tests.level).toBe("substantial"); // D2=75
    expect(pp.productionReadiness.tests.frameworks).toEqual(expect.arrayContaining(["vitest", "playwright"]));
    expect(pp.productionReadiness.observability.level).toBe("errors"); // sentry
    expect(pp.productionReadiness.delivery.migrations).toBe("versioned");
    expect(["beta", "production", "hardened"]).toContain(pp.productionReadiness.band);
    expect(pp.evidence.source).toBe("static-scan");
  });

  it("identity: private/public from meta, archetype from the report", () => {
    expect(pp.identity.visibility).toBe("public");
    expect(pp.identity.archetype).toBe("team");
    expect(pp.identity.version).toBe("1.2.0");
  });
});

describe("buildPassport — PRESENT vs ENFORCED honesty cap (tokenless scan)", () => {
  it("caps CI at 'checks' (NOT gated) and flags it when governance is null", () => {
    const pp = buildPassport(report({ governance: null }), fullSnap());
    expect(pp.productionReadiness.ci.level).toBe("checks"); // cannot prove enforcement without a token
    expect(pp.productionReadiness.ci.gates).toEqual([]);
    expect(pp.evidence.source).toContain("no branch-protection visibility");
    expect(pp.productionReadiness.blockers.some((b) => /not observable/i.test(b))).toBe(true);
  });

  it("the SAME repo reaches 'gated' once a token sees branch protection", () => {
    expect(buildPassport(report({ governance: gov() }), fullSnap()).productionReadiness.ci.level).toBe("gated");
  });
});

describe("buildPassport — determinism + parse", () => {
  it("yields byte-identical output for the same inputs", () => {
    const r = report();
    const s = fullSnap();
    expect(buildPassport(r, s)).toEqual(buildPassport(r, s));
  });

  it("round-trips through parsePassportJson; null on garbage", () => {
    const pp = buildPassport(report(), fullSnap());
    expect(parsePassportJson(JSON.stringify(pp))).toEqual(pp);
    expect(parsePassportJson(null)).toBeNull();
    expect(parsePassportJson("{}")).toBeNull();
    expect(parsePassportJson("not json")).toBeNull();
  });

  it("a bare repo (no manifests) degrades to empty/none, not a crash", () => {
    const pp = buildPassport(report({ techStack: undefined, governance: null, dimensions: [] as unknown as ScanReport["dimensions"] }), snap({}));
    expect(pp.stack.persistence).toEqual([]);
    expect(pp.productionReadiness.ci.level).toBe("none");
    expect(pp.productionReadiness.observability.level).toBe("none");
    expect(pp.automationReadiness.selfVerify).toEqual({ build: false, test: false, lint: false, typecheck: false });
  });
});

// ── 0.2.0: graded artifact ladders ────────────────────────────────────────────────────────────────
// The ladder must be a FLOOR, never a guess: each rung needs evidence the snapshot actually carries, and
// `governed` needs process evidence that only fetched file CONTENT (or CI text) can prove.
describe("buildPassport — memory ladder (none → adhoc → curated → governed)", () => {
  const grade = (opts: { tree?: string[]; files?: Record<string, string> }) =>
    buildPassport(report(), snap({ tree: ["package.json", ...(opts.tree ?? [])], files: { "package.json": PKG, ...(opts.files ?? {}) } })).automationReadiness
      .artifacts.memory;

  it("none — no memory home at all", () => {
    expect(grade({})).toBe("none");
  });

  it("adhoc — a single flat memory file is presence, not structure", () => {
    expect(grade({ tree: [".ai/memory.md"] })).toBe("adhoc");
    expect(grade({ tree: [".ai/memory/notes.md"] })).toBe("adhoc"); // one lone entry
  });

  it("curated — several per-fact entries, or an index plus an entry", () => {
    expect(grade({ tree: [".ai/memory/auth-decision.md", ".ai/memory/pglite-drift.md"] })).toBe("curated");
    expect(grade({ tree: [".ai/memory/index.md", ".ai/memory/auth-decision.md"] })).toBe("curated");
  });

  it("governed — curated PLUS a supersede lineage link in fetched content", () => {
    expect(
      grade({
        tree: [".ai/memory/a.md", ".ai/memory/b.md"],
        files: { ".ai/memory/b.md": "# B\nsuperseded-by: .ai/memory/c.md\n" },
      }),
    ).toBe("governed");
  });

  it("governed — curated PLUS a CI job that checks the memory tree", () => {
    expect(
      grade({
        tree: [".ai/memory/a.md", ".ai/memory/b.md", ".github/workflows/ci.yml"],
        files: { ".github/workflows/ci.yml": "jobs:\n  memcheck:\n    steps:\n      - run: node scripts/lint.mjs .ai/memory\n" },
      }),
    ).toBe("governed");
  });

  it("HONESTY: a curated tree whose files weren't fetched caps at curated, never governed", () => {
    // The tree lists the entries but no content came back within the byte budget — no lineage provable.
    expect(grade({ tree: [".ai/memory/a.md", ".ai/memory/b.md", ".ai/memory/c.md"] })).toBe("curated");
  });
});

describe("buildPassport — skills ladder (none → adhoc → curated → governed)", () => {
  const grade = (opts: { tree?: string[]; files?: Record<string, string>; pkg?: string }) =>
    buildPassport(report(), snap({ tree: ["package.json", ...(opts.tree ?? [])], files: { "package.json": opts.pkg ?? PKG, ...(opts.files ?? {}) } }))
      .automationReadiness.artifacts.skills;

  it("none — no skills home", () => {
    expect(grade({})).toBe("none");
  });

  it("adhoc — loose files, or a single named skill, is not a library", () => {
    expect(grade({ tree: [".claude/skills/scratch.md"] })).toBe("adhoc"); // loose, no skill dir
    expect(grade({ tree: [".claude/skills/deploy/skill.md"] })).toBe("adhoc"); // exactly one skill
  });

  it("curated — >=2 distinct skills that each carry their own definition file", () => {
    expect(grade({ tree: [".claude/skills/deploy/skill.md", ".claude/skills/review/skill.md"] })).toBe("curated");
  });

  it("governed — curated PLUS a registry at the skills root", () => {
    expect(grade({ tree: [".claude/skills/deploy/skill.md", ".claude/skills/review/skill.md", ".claude/skills/index.md"] })).toBe("governed");
  });

  it("governed — curated PLUS a package script that validates them", () => {
    const pkg = JSON.stringify({ scripts: { "lint:skills": "node scripts/check-skills.mjs" } });
    expect(grade({ tree: [".claude/skills/deploy/skill.md", ".claude/skills/review/skill.md"], pkg })).toBe("governed");
  });

  it("a `none` rung surfaces as an automation blocker (the thing an owner may then decline)", () => {
    const pp = buildPassport(report(), fullSnap());
    expect(pp.automationReadiness.blockers.some((b) => /^No agent memory/.test(b))).toBe(true);
    expect(pp.automationReadiness.blockers.some((b) => /^No reusable agent skills/.test(b))).toBe(true);
  });
});

// ── 0.2.0: version migration on read ──────────────────────────────────────────────────────────────
const V010: AppPassport = {
  passport: "app-passport",
  passportVersion: "0.1.0",
  generatedAt: "2026-01-01",
  generatedBy: "ascent-scan",
  identity: { name: "web", slug: "web", purpose: "p", archetype: "team", visibility: "public", license: null },
  stack: { languages: [], frameworks: [], persistence: [], monitoring: { errorTracking: null, logs: null, metrics: null, tracing: null, uptime: null }, hosting: null, integrations: [] },
  automationReadiness: {
    level: "L3",
    score: 50,
    // the 0.1.0 shape: booleans where 0.2.0 has ladders
    artifacts: { agentInstructions: ["CLAUDE.md"], contextGraph: "full", memory: true, manifest: false, evals: "none", skills: false } as unknown as AppPassport["automationReadiness"]["artifacts"],
    selfVerify: { build: true, test: true, lint: false, typecheck: false },
    aiInWorkflow: true,
    blockers: [],
  },
  productionReadiness: {
    band: "beta",
    score: 50,
    ci: { level: "checks", provider: "github-actions", gates: [] },
    tests: { level: "partial", coveragePct: null, frameworks: [], criticalPathCovered: false },
    security: { level: "none", tools: [] },
    observability: { level: "none" },
    delivery: { migrations: "none", iac: false, rollback: false },
    blockers: [],
  },
  links: {},
  evidence: { confidence: 0.7, source: "static-scan", files: [] },
};

describe("upgradePassport — 0.1.0 → current on read", () => {
  it("lifts boolean memory/skills to the ladder: true→adhoc, false→none", () => {
    const up = upgradePassport(V010);
    expect(up.automationReadiness.artifacts.memory).toBe("adhoc");
    expect(up.automationReadiness.artifacts.skills).toBe("none");
    expect(up.passportVersion).toBe(PASSPORT_VERSION);
  });

  it("TAGS the result so a migrated floor is never read as a fresh assessment", () => {
    const up = upgradePassport(V010);
    expect(up.migratedFrom).toBe("0.1.0");
    expect(up.evidence.notes?.some((n) => /migration floors|Lifted from passport 0\.1\.0/i.test(n))).toBe(true);
  });

  it("is pure — the stored object is never mutated", () => {
    upgradePassport(V010);
    expect((V010.automationReadiness.artifacts as unknown as { memory: unknown }).memory).toBe(true);
    expect(V010.passportVersion).toBe("0.1.0");
  });

  it("is a no-op (same reference) for an already-current passport, and idempotent", () => {
    const fresh = buildPassport(report(), fullSnap());
    expect(upgradePassport(fresh)).toBe(fresh);
    const once = upgradePassport(V010);
    expect(upgradePassport(once)).toBe(once);
  });

  it("treats a missing/garbage version as the oldest shape (conservative)", () => {
    const noVersion = { ...V010, passportVersion: "" } as AppPassport;
    expect(upgradePassport(noVersion).migratedFrom).toBe("0.1.0");
    expect(upgradePassport(noVersion).automationReadiness.artifacts.memory).toBe("adhoc");
  });

  it("parsePassportJson is the read-path seam — a stored 0.1.0 blob comes back migrated", () => {
    const parsed = parsePassportJson(JSON.stringify(V010));
    expect(parsed?.automationReadiness.artifacts.memory).toBe("adhoc");
    expect(parsed?.passportVersion).toBe(PASSPORT_VERSION);
    expect(parsed?.migratedFrom).toBe("0.1.0");
  });
});

// ── 0.2.0: declined by choice ─────────────────────────────────────────────────────────────────────
describe("applyPassportOverrides — declined by choice", () => {
  // A bare repo: carries the observability / CI / memory / skills blockers a decline stands down.
  // The package.json is load-bearing since 0.4.0 — WITHOUT it the monitoring deps are unobservable, so
  // the honest finding is "could not assess", not "zero observability" (see the three-valued tests).
  const base = buildPassport(report({ governance: null }), snap({ tree: ["package.json"], files: { "package.json": "{}" } }));

  it("retires the matching blocker and re-renders it as an annotated decision", () => {
    expect(base.productionReadiness.blockers.some((b) => /^Zero observability/.test(b))).toBe(true);
    const pp = applyPassportOverrides(base, {
      declined: { "stack.monitoring.errorTracking": { reason: "Internal cron worker; platform pages on failure." } },
    });
    expect(pp.productionReadiness.blockers.some((b) => /^Zero observability/.test(b))).toBe(false);
    expect(pp.declined).toEqual([
      {
        path: "stack.monitoring.errorTracking",
        label: "Error tracking",
        reason: "Internal cron worker; platform pages on failure.",
        blocker: expect.stringMatching(/^Zero observability/),
        // 0.4.0: the minted id is what the decision is attached to; `blocker` is now only payload.
        findingId: "prod.zero-observability",
      },
    ]);
  });

  it("NEVER moves a score — a decline is a decision, not a fix", () => {
    const pp = applyPassportOverrides(base, { declined: { "productionReadiness.observability": {}, "productionReadiness.ci": {} } });
    expect(pp.productionReadiness.score).toBe(base.productionReadiness.score);
    expect(pp.productionReadiness.band).toBe(base.productionReadiness.band);
    expect(pp.automationReadiness.score).toBe(base.automationReadiness.score);
  });

  it("declines an automation-axis gap too, and leaves the input untouched", () => {
    const pp = applyPassportOverrides(base, { declined: { "automationReadiness.artifacts.memory": { reason: "Single-owner repo." } } });
    expect(pp.automationReadiness.blockers.some((b) => /^No agent memory/.test(b))).toBe(false);
    expect(base.automationReadiness.blockers.some((b) => /^No agent memory/.test(b))).toBe(true);
    expect(base.declined).toBeUndefined();
  });

  it("SURVIVES A RE-SCAN: the same overlay re-applies to a freshly built passport", () => {
    // A re-scan rewrites passportJson only; the declines live in the overrides store, keyed by field path.
    const ov = parsePassportOverrides(JSON.stringify({ declined: { "stack.monitoring.errorTracking": { reason: "by choice" } } }));
    const rescanned = buildPassport(report({ governance: null, overallScore: 81 }), snap({}));
    const pp = applyPassportOverrides(rescanned, ov);
    expect(pp.declined?.[0]?.path).toBe("stack.monitoring.errorTracking");
    expect(pp.declined?.[0]?.reason).toBe("by choice");
    expect(pp.productionReadiness.blockers.some((b) => /^Zero observability/.test(b))).toBe(false);
  });

  it("is deterministic — declines render sorted by path", () => {
    const pp = applyPassportOverrides(base, {
      declined: { "productionReadiness.delivery.iac": {}, "automationReadiness.artifacts.evals": {} },
    });
    expect(pp.declined?.map((d) => d.path)).toEqual(["automationReadiness.artifacts.evals", "productionReadiness.delivery.iac"]);
  });

  it("ignores an unknown field path (must-ignore-unknown) rather than inventing a decline", () => {
    const pp = applyPassportOverrides(base, { declined: { "productionReadiness.notAField": {} } as never });
    expect(pp.declined).toBeUndefined();
  });
});

describe("parseDeclined / isDeclinablePath — allow-list validation", () => {
  it("keeps allow-listed paths, drops the rest", () => {
    expect(isDeclinablePath("stack.monitoring.errorTracking")).toBe(true);
    expect(isDeclinablePath("productionReadiness.score")).toBe(false);
    // the tokenless enforcement caveat is deliberately NOT declinable — that's an evidence limit
    expect(isDeclinablePath("evidence.source")).toBe(false);
    expect(parseDeclined({ "stack.monitoring.logs": {}, bogus: {} })).toEqual({ "stack.monitoring.logs": {} });
    expect(parseDeclined({ bogus: {} })).toBeNull();
    expect(parseDeclined(null)).toBeNull();
    expect(parseDeclined([])).toBeNull();
  });

  it("trims + caps a reason and drops a malformed date", () => {
    const out = parseDeclined({ "stack.monitoring.metrics": { reason: `  ${"x".repeat(400)}  `, at: "yesterday" } });
    expect(out?.["stack.monitoring.metrics"]?.reason).toHaveLength(280);
    expect(out?.["stack.monitoring.metrics"]?.at).toBeUndefined();
    expect(parseDeclined({ "stack.monitoring.metrics": { at: "2026-07-27" } })?.["stack.monitoring.metrics"]?.at).toBe("2026-07-27");
  });

  it("round-trips through the stored-overrides parser alongside the P4 fields", () => {
    const raw = JSON.stringify({ criticality: "business", declined: { "productionReadiness.tests": { reason: "prototype" }, nope: {} } });
    expect(parsePassportOverrides(raw)).toEqual({ criticality: "business", declined: { "productionReadiness.tests": { reason: "prototype" } } });
  });
});

describe("applyPassportOverrides — owner overlay (P4)", () => {
  const base = buildPassport(report(), fullSnap());

  it("is a no-op (same reference semantics) when there are no overrides", () => {
    expect(applyPassportOverrides(base, null)).toBe(base);
    expect(applyPassportOverrides(base, {})).toBe(base);
  });

  it("sets criticality + lifecycle on identity without touching the scores", () => {
    const pp = applyPassportOverrides(base, { criticality: "mission-critical", lifecycle: "ga" });
    expect(pp.identity.criticality).toBe("mission-critical");
    expect(pp.identity.lifecycle).toBe("ga");
    expect(pp.productionReadiness.score).toBe(base.productionReadiness.score); // unchanged
    expect(base.identity.criticality).toBeUndefined(); // input not mutated
  });

  it("a rollback override flips delivery AND re-derives the production score/band (lifts it)", () => {
    const pp = applyPassportOverrides(base, { rollback: true });
    expect(pp.productionReadiness.delivery.rollback).toBe(true);
    expect(pp.productionReadiness.score).toBeGreaterThan(base.productionReadiness.score);
  });
});

describe("parsePassportOverrides — validation", () => {
  it("keeps valid enum/boolean values, drops unknowns, null when empty", () => {
    expect(parsePassportOverrides(JSON.stringify({ criticality: "business", lifecycle: "beta", rollback: true }))).toEqual({ criticality: "business", lifecycle: "beta", rollback: true });
    expect(parsePassportOverrides(JSON.stringify({ criticality: "bogus", lifecycle: "nope" }))).toBeNull();
    expect(parsePassportOverrides(null)).toBeNull();
    expect(parsePassportOverrides("{}")).toBeNull();
  });
});
