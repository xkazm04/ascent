// Tests for the App Readiness Passport builder (P1). buildPassport is pure over (report, snapshot), so
// these drive synthetic reports/snapshots to pin: the named-stack/persistence/integration detection,
// the maturity-ladder automation axis, the derived production band, determinism, and — the load-bearing
// one — the PRESENT-vs-ENFORCED honesty cap: a tokenless scan (governance null) must NOT claim a "gated"
// CI/security rung it couldn't observe, and must say so in evidence/blockers.

import { describe, it, expect } from "vitest";
import { buildPassport, parsePassportJson } from "@/lib/analyze/passport";
import type { Governance, RepoMeta, RepoSnapshot, ScanReport, TechStack } from "@/lib/types";

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
