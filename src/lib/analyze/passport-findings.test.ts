// Passport 0.4.0 — the three conflations it un-picks, and the decline lifecycle they make possible.
//
// Split out of passport.test.ts as a themed sibling (the local pattern) because these all pin the same
// property from different angles: a persisted judgment must never be attached to something that can be
// regenerated, and two different facts must never share one encoding.
//
//   items covered: identity-by-display-text (passport half) · named-vs-capability-unknown ·
//                  passport-confidence-coarse · decline-no-resurfacing

import { describe, it, expect } from "vitest";
import {
  DECLINE_MAX_AGE_DAYS,
  FIELD_EVIDENCE,
  UNKNOWN_CAPABILITY,
  applyPassportOverrides,
  buildPassport,
  isCoverageHoleFinding,
  parseDeclined,
  parsePassportJson,
} from "@/lib/analyze/passport";
import type { AppPassport, RepoMeta, RepoSnapshot, ScanReport } from "@/lib/types";

type Snap = Pick<RepoSnapshot, "meta" | "tree" | "files" | "commits" | "coverage">;
const meta = (): RepoMeta => ({ owner: "acme", name: "web", url: "https://github.com/acme/web", stars: 0, forks: 0, defaultBranch: "main", primaryLanguage: "TypeScript" });

function snap(opts: { tree?: string[]; files?: Record<string, string> } = {}): Snap {
  return {
    meta: meta(),
    tree: (opts.tree ?? []).map((p) => ({ path: p, type: "blob" as const })),
    files: Object.entries(opts.files ?? {}).map(([path, content]) => ({ path, content, bytes: content.length })),
    commits: [],
    coverage: 1,
  };
}
function report(over: Partial<ScanReport> = {}): ScanReport {
  return {
    repo: meta(),
    overallScore: 50,
    level: { id: "L3", name: "x", band: [45, 64], tagline: "", description: "" },
    archetype: "team",
    confidence: 0.8,
    dimensions: [{ id: "D2", score: 50 }],
    techStack: undefined,
    governance: null,
    prStats: null,
    scannedAt: "2026-06-22T12:00:00Z",
    ...over,
  } as unknown as ScanReport;
}

/** A repo whose dependency list IS readable and names nothing: a real "no observability" verdict. */
const inspected = (pkg = "{}") => snap({ tree: ["package.json"], files: { "package.json": pkg } });
/** A repo whose dependency list is NOT in the snapshot: nothing can be classified from it. */
const uninspected = () => snap({ tree: ["main.py"] });

// ── named-vs-capability-unknown ───────────────────────────────────────────────────────────────────
describe("named capability fields are three-valued (absent vs could-not-classify)", () => {
  it("null when the scan LOOKED and the app has none", () => {
    const pp = buildPassport(report(), inspected());
    expect(pp.stack.monitoring.errorTracking).toBeNull();
    expect(pp.stack.monitoring.tracing).toBeNull();
  });

  it("UNKNOWN when the evidence the classifier needs was not in the snapshot", () => {
    const pp = buildPassport(report(), uninspected());
    expect(pp.stack.monitoring.errorTracking).toBe(UNKNOWN_CAPABILITY);
    expect(pp.stack.monitoring.metrics).toBe(UNKNOWN_CAPABILITY);
  });

  it("tree-derived named fields turn unknown on their own evidence, not the dependency list", () => {
    const pp = buildPassport(report(), snap({})); // no tree at all
    expect(pp.stack.hosting).toBe(UNKNOWN_CAPABILITY);
    expect(pp.stack.monitoring.uptime).toBe(UNKNOWN_CAPABILITY);
  });

  it("does NOT let the unknown sentinel promote a rung — it is a truthy string", () => {
    // The bug this pins: a plain truthiness test reads "unknown" as a vendor and claims full tracing.
    const pp = buildPassport(report(), uninspected());
    expect(pp.productionReadiness.observability.level).toBe("none");
  });

  it("reports the SCAN's blind spot as a scan limitation, never as a gap in the app's stack", () => {
    const blind = buildPassport(report(), uninspected()).productionReadiness;
    expect(blind.findings?.map((f) => f.id)).toContain("prod.observability-unassessable");
    expect(blind.findings?.map((f) => f.id)).not.toContain("prod.zero-observability");
    // G4: a coverage hole is not a scored blocker — the rung names it; Blockers does not.
    expect(blind.blockers.some((b) => /could not be assessed/i.test(b))).toBe(false);

    const seen = buildPassport(report(), inspected()).productionReadiness;
    expect(seen.findings?.map((f) => f.id)).toContain("prod.zero-observability");
    expect(seen.findings?.map((f) => f.id)).not.toContain("prod.observability-unassessable");
    expect(seen.blockers.some((b) => /^Zero observability/.test(b))).toBe(true);
  });
});

// ── passport-confidence-coarse ────────────────────────────────────────────────────────────────────
describe("evidence.fields — per-field detection strength", () => {
  it("rates a dependency-declared vendor BELOW a fetched-command observation", () => {
    const pp = buildPassport(report(), snap({
      tree: ["package.json", ".github/workflows/ci.yml"],
      files: { "package.json": JSON.stringify({ dependencies: { "@sentry/node": "8" } }), ".github/workflows/ci.yml": "jobs:\n  x:\n    steps:\n      - run: npm test" },
    }));
    const f = pp.evidence.fields!;
    expect(f["stack.monitoring.errorTracking"]).toEqual(FIELD_EVIDENCE.declared);
    expect(f["productionReadiness.ci"]).toEqual(FIELD_EVIDENCE.observed);
    expect(f["stack.monitoring.errorTracking"]!.confidence).toBeLessThan(f["productionReadiness.ci"]!.confidence);
  });

  it("rates a path heuristic below a declaration, and an unobservable field at zero", () => {
    const pp = buildPassport(report(), uninspected()).evidence.fields!;
    expect(pp["stack.hosting"]).toEqual(FIELD_EVIDENCE.inferred);
    expect(pp["stack.monitoring.logs"]).toEqual(FIELD_EVIDENCE.unobserved);
  });

  it("keeps a FIXED value per rung so two passports stay comparable", () => {
    expect(FIELD_EVIDENCE.observed.confidence).toBe(1);
    expect(FIELD_EVIDENCE.declared.confidence).toBe(0.8);
    expect(FIELD_EVIDENCE.inferred.confidence).toBe(0.5);
    expect(FIELD_EVIDENCE.unobserved.confidence).toBe(0);
  });

  it("leaves the whole-artifact confidence alone — it answers a different question", () => {
    expect(buildPassport(report({ confidence: 0.42 }), inspected()).evidence.confidence).toBe(0.42);
  });
});

// ── identity-by-display-text (passport half) ──────────────────────────────────────────────────────
describe("blockers carry a minted id that survives a rewording", () => {
  const base = buildPassport(report(), inspected());

  it("mints the CAUSE, not the wording — blockers[] is the scored projection of findings[]", () => {
    const scored = base.productionReadiness.findings!.filter((f) => !isCoverageHoleFinding(f)).map((f) => f.text);
    expect(base.productionReadiness.blockers).toEqual(scored);
    expect(base.automationReadiness.findings!.map((f) => f.id)).toContain("auto.no-memory");
    expect(base.productionReadiness.findings!.map((f) => f.id)).toContain("prod.enforcement-not-observable");
    expect(base.productionReadiness.blockers.some((b) => /not observable/i.test(b))).toBe(false);
  });

  it("a REWORDED blocker keeps its decline — the join is on the id, not the sentence", () => {
    // Simulate the next release rewriting the copy. Before 0.4.0 this silently orphaned the decline:
    // the accepted gap reappeared as an open blocker and the owner's reason was lost.
    const reworded: AppPassport = JSON.parse(JSON.stringify(base));
    const f = reworded.productionReadiness.findings!.find((x) => x.id === "prod.zero-observability")!;
    const i = reworded.productionReadiness.blockers.indexOf(f.text);
    f.text = "This service emits no telemetry of any kind.";
    reworded.productionReadiness.blockers[i] = f.text;

    const pp = applyPassportOverrides(reworded, { declined: { "productionReadiness.observability": { reason: "edge worker" } } });
    expect(pp.productionReadiness.blockers).not.toContain(f.text);
    expect(pp.declined?.[0]).toMatchObject({ findingId: "prod.zero-observability", blocker: f.text, reason: "edge worker" });
  });

  it("retires the line from findings[] and blockers[] together, so they never drift", () => {
    const pp = applyPassportOverrides(base, { declined: { "productionReadiness.ci": {} } });
    expect(pp.productionReadiness.findings!.map((f) => f.id)).not.toContain("prod.ci-not-gating");
    expect(pp.productionReadiness.blockers).toEqual(
      pp.productionReadiness.findings!.filter((f) => !isCoverageHoleFinding(f)).map((f) => f.text),
    );
  });

  it("back-fills ids for a stored pre-0.4.0 row so an existing decline is not orphaned by the fix", () => {
    const stored = { ...JSON.parse(JSON.stringify(base)), passportVersion: "0.3.0" } as AppPassport;
    delete stored.automationReadiness.findings;
    delete stored.productionReadiness.findings;
    delete stored.evidence.fields; // a real 0.3.0 row never had these
    const lifted = parsePassportJson(JSON.stringify(stored))!;
    expect(lifted.productionReadiness.findings!.map((f) => f.id)).toContain("prod.zero-observability");
    expect(lifted.migratedFrom).toBe("0.3.0");
    expect(lifted.evidence.notes?.some((n) => /0\.4\.0/.test(n))).toBe(true);
    // A migrated row must not claim a per-field strength its scan never measured — the migration adds
    // nothing here, so a reader falls back to the whole-artifact confidence exactly as it did before.
    expect(lifted.evidence.fields).toBeUndefined();
    const pp = applyPassportOverrides(lifted, { declined: { "productionReadiness.observability": { reason: "still fine" } } });
    expect(pp.productionReadiness.blockers.some((b) => /^Zero observability/.test(b))).toBe(false);
  });
});

// ── decline-no-resurfacing ────────────────────────────────────────────────────────────────────────
describe("a decline is re-confirmed when the repo it was made about changes", () => {
  const base = buildPassport(report(), inspected());
  const declineAt = (at: string, extra: Record<string, unknown> = {}) => ({
    declined: { "productionReadiness.security": { reason: "internal prototype", at, ...extra } },
  });

  it("stands, and stays out of the blocker list, while nothing has changed", () => {
    const pp = applyPassportOverrides(base, declineAt("2026-06-01", { code: "no-security-scanning", severity: "block" }));
    expect(pp.productionReadiness.blockers.some((b) => /^No dependency/.test(b))).toBe(false);
    expect(pp.declined?.[0]?.needsReconfirm).toBeUndefined();
  });

  it("RE-SURFACES when the gap hardens: the blocker stays open AND the decision is annotated", () => {
    // The item's exact story — accepted while the repo was an internal prototype, then it went GA.
    const ga = applyPassportOverrides(base, {
      lifecycle: "ga",
      criticality: "business",
      ...declineAt("2026-06-01", { code: "no-security-scanning", severity: "block" }),
    });
    expect(ga.productionReadiness.blockers.some((b) => /^No dependency/.test(b))).toBe(true);
    expect(ga.declined?.[0]).toMatchObject({ needsReconfirm: true, reconfirmReason: expect.stringMatching(/hardened/i) });
  });

  it("RE-SURFACES when the finding changed KIND under the same field path", () => {
    const pp = applyPassportOverrides(base, declineAt("2026-06-01", { code: "some-older-code", severity: "block" }));
    expect(pp.declined?.[0]?.reconfirmReason).toMatch(/changed kind/i);
    expect(pp.productionReadiness.blockers.some((b) => /^No dependency/.test(b))).toBe(true);
  });

  it("RE-SURFACES when the decision ages past the window — measured off generatedAt, never a clock", () => {
    const old = applyPassportOverrides(base, declineAt("2024-01-01", { code: "no-security-scanning", severity: "block" }));
    expect(old.declined?.[0]?.reconfirmReason).toMatch(new RegExp(`${DECLINE_MAX_AGE_DAYS}-day`));
    const fresh = applyPassportOverrides(base, declineAt("2026-06-01", { code: "no-security-scanning", severity: "block" }));
    expect(fresh.declined?.[0]?.needsReconfirm).toBeUndefined();
  });

  it("does NOT re-surface on a rewording — that is the reflexive re-declining the ids exist to avoid", () => {
    const reworded: AppPassport = JSON.parse(JSON.stringify(base));
    const f = reworded.productionReadiness.findings!.find((x) => x.id === "prod.no-security-scanning")!;
    const i = reworded.productionReadiness.blockers.indexOf(f.text);
    f.text = "Nothing scans this repo's dependencies.";
    reworded.productionReadiness.blockers[i] = f.text;
    const pp = applyPassportOverrides(reworded, declineAt("2026-06-01", { code: "no-security-scanning", severity: "block" }));
    expect(pp.declined?.[0]?.needsReconfirm).toBeUndefined();
  });

  it("a pre-0.4.0 decline has NO baseline, so kind/severity are unknown rather than fabricated", () => {
    // No `code`/`severity` recorded. Escalating GA must not re-open it (we cannot know it hardened),
    // but the age rule still applies because `at` was always stored.
    const pp = applyPassportOverrides(base, { lifecycle: "ga", ...declineAt("2026-06-01") });
    expect(pp.declined?.[0]?.needsReconfirm).toBeUndefined();
    const aged = applyPassportOverrides(base, { lifecycle: "ga", ...declineAt("2020-01-01") });
    expect(aged.declined?.[0]?.needsReconfirm).toBe(true);
  });

  it("never moves a score, re-surfaced or not — a decline is a decision, not a fix", () => {
    const pp = applyPassportOverrides(base, { lifecycle: "ga", ...declineAt("2020-01-01", { severity: "info" }) });
    expect(pp.productionReadiness.score).toBe(base.productionReadiness.score);
  });

  it("parseDeclined keeps a valid baseline and drops a malformed one", () => {
    const ok = parseDeclined({ "productionReadiness.ci": { code: "ci-not-gating", severity: "block", at: "2026-01-02" } });
    expect(ok?.["productionReadiness.ci"]).toEqual({ at: "2026-01-02", code: "ci-not-gating", severity: "block" });
    const bad = parseDeclined({ "productionReadiness.ci": { code: "Not A Code!", severity: "catastrophic" } });
    expect(bad?.["productionReadiness.ci"]).toEqual({});
  });
});

// ── the fourth conflation: "we read no CI gates" vs "we never read the workflows" ─────────────────
//
// Workflow CONTENT reaches `probes()` through a BOUNDED fetch — a reserved 24-file quota, a per-file
// byte cap, and a byte plan that displaces picks (see forge/source-selection.ts) — while the tree
// listing is complete. When the two disagree, `workflowText` is short of what the repository has, and
// the CI/Security detectors read that shortfall as an absence. The same conflation UNKNOWN_CAPABILITY
// un-picks for the dependency list, one field over.
describe("bounded workflow reads are a coverage fact, not an absence", () => {
  const wf = ".github/workflows/ci.yml";
  const CLEAN_WF = "name: ci\njobs:\n  test:\n    steps:\n      - run: npm test\n";
  const SAST_WF = "name: ci\njobs:\n  codeql:\n    steps:\n      - uses: github/codeql-action/analyze\n";
  type F = { path: string; content: string; bytes: number };
  const snapWf = (tree: string[], files: F[]): Snap => ({
    meta: meta(),
    tree: tree.map((p) => ({ path: p, type: "blob" as const })),
    files,
    commits: [],
    coverage: 1,
  });
  const ids = (s: Snap) => (buildPassport(report(), s).productionReadiness.findings ?? []).map((f) => `${f.id}:${f.severity}`);

  it("case 1 observed-real-gap: content read, nothing scanning — the blocks stand", () => {
    const got = ids(snapWf(["package.json", wf], [{ path: wf, content: CLEAN_WF, bytes: CLEAN_WF.length }]));
    expect(got).toContain("prod.ci-not-gating:block");
    expect(got).toContain("prod.no-security-scanning:block");
  });

  it("case 2 unread: the tree lists a workflow the snapshot does not carry", () => {
    const s = snapWf(["package.json", wf], []);
    const got = ids(s);
    expect(got).toContain("prod.ci-unassessable:info");
    expect(got).toContain("prod.security-unassessable:info");
    expect(got).not.toContain("prod.ci-not-gating:block");
    expect(got).not.toContain("prod.no-security-scanning:block");
    expect(buildPassport(report(), s).productionReadiness.blockers.some((b) => /could not be assessed/i.test(b))).toBe(false);
  });

  it("case 3 partial: three workflows listed, one read", () => {
    const got = ids(
      snapWf(["package.json", wf, ".github/workflows/release.yml", ".github/workflows/audit.yml"], [
        { path: wf, content: CLEAN_WF, bytes: CLEAN_WF.length },
      ]),
    );
    expect(got).toContain("prod.ci-unassessable:info");
    expect(got).not.toContain("prod.no-security-scanning:block");
  });

  it("case 4 truncated: the one workflow read was cut at the per-file cap", () => {
    const got = ids(snapWf(["package.json", wf], [{ path: wf, content: CLEAN_WF, bytes: CLEAN_WF.length + 4096 }]));
    expect(got).toContain("prod.ci-unassessable:info");
    expect(got).not.toContain("prod.ci-not-gating:block");
  });

  it("case 5 no-workflows: an OBSERVED absence still blocks (the rule must not swallow real gaps)", () => {
    const got = ids(snapWf(["package.json", "main.py"], []));
    expect(got).toContain("prod.ci-not-gating:block");
    expect(got).toContain("prod.no-security-scanning:block");
    expect(got).not.toContain("prod.ci-unassessable:info");
  });

  it("case 6 observed-clean: scanning found in read content — no security block either way", () => {
    const got = ids(snapWf(["package.json", wf], [{ path: wf, content: SAST_WF, bytes: SAST_WF.length }]));
    expect(got).not.toContain("prod.no-security-scanning:block");
    expect(got).not.toContain("prod.security-unassessable:info");
  });
});

// ── the fifth conflation: "we read no tests/scripts" vs "we never read package.json" ───────────────
//
// detectTests forces level none when frameworks.length===0; detectSelfVerify treats missing scripts
// as false and mints auto.self-verify-gaps at block. Both read package.json. When the same
// depsObservable probe monitoring uses is false, empty is unread, not absence (G4).
describe("unread package.json is unassessable for tests and self-verify", () => {
  const autoIds = (s: Snap, over: Partial<ScanReport> = {}) =>
    (buildPassport(report(over), s).automationReadiness.findings ?? []).map((f) => `${f.id}:${f.severity}`);
  const prodIds = (s: Snap, over: Partial<ScanReport> = {}) =>
    (buildPassport(report(over), s).productionReadiness.findings ?? []).map((f) => `${f.id}:${f.severity}`);

  it("2 of 2 detectors honor depsObservable: no package.json is unassessable, not none/block", () => {
    const s = uninspected();
    const highD2 = { dimensions: [{ id: "D2", score: 75 }] as unknown as ScanReport["dimensions"] };
    const auto = autoIds(s);
    const prod = prodIds(s, highD2);
    expect(prod).toContain("prod.tests-unassessable:info");
    expect(auto).toContain("auto.self-verify-unassessable:info");
    expect(auto).not.toContain("auto.self-verify-gaps:block");
    const pp = buildPassport(report(highD2), s);
    expect(pp.productionReadiness.tests.frameworks).toEqual([]);
    expect(pp.productionReadiness.blockers.some((b) => /could not be assessed/i.test(b))).toBe(false);
    expect(pp.automationReadiness.blockers.some((b) => /self-verify/i.test(b))).toBe(false);
    expect(isCoverageHoleFinding({ id: "prod.tests-unassessable", code: "tests-unassessable" })).toBe(true);
    expect(isCoverageHoleFinding({ id: "auto.self-verify-unassessable", code: "self-verify-unassessable" })).toBe(true);
  });

  it("listed-but-unread package.json (tree has it, files do not) is the same coverage hole", () => {
    const s = snap({ tree: ["package.json", "src/index.ts"] });
    expect(prodIds(s)).toContain("prod.tests-unassessable:info");
    expect(autoIds(s)).toContain("auto.self-verify-unassessable:info");
    expect(autoIds(s)).not.toContain("auto.self-verify-gaps:block");
  });

  it("malformed package.json is unread, not an empty manifest", () => {
    const s = snap({ tree: ["package.json"], files: { "package.json": "{not json" } });
    expect(prodIds(s)).toContain("prod.tests-unassessable:info");
    expect(autoIds(s)).not.toContain("auto.self-verify-gaps:block");
  });

  it("when package.json WAS read and truly has no tests/scripts, keep today's none/block", () => {
    const s = inspected();
    const highD2 = { dimensions: [{ id: "D2", score: 75 }] as unknown as ScanReport["dimensions"] };
    const pp = buildPassport(report(highD2), s);
    expect(pp.productionReadiness.tests.level).toBe("none");
    expect(prodIds(s, highD2)).not.toContain("prod.tests-unassessable:info");
    expect(autoIds(s)).toContain("auto.self-verify-gaps:block");
    expect(autoIds(s)).not.toContain("auto.self-verify-unassessable:info");
    expect(pp.automationReadiness.blockers.some((b) => /^Agent can't self-verify/.test(b))).toBe(true);
  });

  it("a readable package.json with frameworks and scripts keeps the measured level, not a hole", () => {
    const s = inspected(
      JSON.stringify({
        scripts: { build: "next build", test: "vitest run", lint: "eslint .", typecheck: "tsc --noEmit" },
        devDependencies: { vitest: "4" },
      }),
    );
    const highD2 = { dimensions: [{ id: "D2", score: 75 }] as unknown as ScanReport["dimensions"] };
    const pp = buildPassport(report(highD2), s);
    expect(pp.productionReadiness.tests.level).toBe("substantial");
    expect(pp.productionReadiness.tests.frameworks).toContain("vitest");
    expect(prodIds(s, highD2)).not.toContain("prod.tests-unassessable:info");
    expect(autoIds(s)).not.toContain("auto.self-verify-gaps:block");
    expect(autoIds(s)).not.toContain("auto.self-verify-unassessable:info");
  });
});
