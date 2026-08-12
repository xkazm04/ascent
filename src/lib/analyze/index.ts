// Deterministic signal extraction. This is the reproducible, auditable backbone of
// every score: plain pattern-matching over the repo tree, sampled file contents, and
// recent commits. No LLM here. The engine later blends these signal scores with the
// LLM's judgment (see src/lib/scoring/engine.ts).

import type {
  AiUsage,
  Contributor,
  DimensionId,
  DimensionSignals,
  PrStats,
  RepoArchetype,
  RepoSnapshot,
  Signal,
} from "@/lib/types";
import { clamp } from "@/lib/maturity/model";
import { AI_TRAILER_SOURCE } from "./ai-tools";

// ---------------------------------------------------------------------------
// Analysis context — precomputed views over the snapshot for cheap querying.
// ---------------------------------------------------------------------------

class RepoIndex {
  readonly paths: string[];
  readonly lowerPaths: string[];
  readonly contentByLowerPath: Map<string, string>;
  readonly workflowText: string;
  readonly manifestText: string;
  private _pathText?: string;
  private _allText?: string;

  constructor(private readonly snap: RepoSnapshot) {
    const blobs = snap.tree.filter((t) => t.type === "blob");
    this.paths = blobs.map((b) => b.path);
    this.lowerPaths = this.paths.map((p) => p.toLowerCase());
    this.contentByLowerPath = new Map(
      snap.files.map((f) => [f.path.toLowerCase(), f.content]),
    );

    this.workflowText = snap.files
      .filter((f) => /^\.github\/workflows\/.+\.ya?ml$/i.test(f.path))
      .map((f) => f.content)
      .join("\n")
      .toLowerCase();

    this.manifestText = snap.files
      .filter((f) =>
        /(^|\/)(package\.json|pyproject\.toml|go\.mod|cargo\.toml|composer\.json|gemfile|pom\.xml|build\.gradle)$/i.test(
          f.path,
        ),
      )
      .map((f) => f.content)
      .join("\n")
      .toLowerCase();
  }

  /** The lowercased path list as one space-joined haystack (`lowerPaths.join(" ")`), built once and
   *  cached — several detectors `.test()` against this and it was an O(paths) rebuild per detector. */
  get pathText(): string {
    return (this._pathText ??= this.lowerPaths.join(" "));
  }

  /** The combined lowercased search-blob `pathText + " " + workflowText + " " + manifestText`, built
   *  once and shared verbatim by the d8/d9 detectors (was reconstructed identically in each). */
  get allText(): string {
    return (this._allText ??= this.pathText + " " + this.workflowText + " " + this.manifestText);
  }

  /** Does any path match the regex? */
  has(re: RegExp): boolean {
    return this.lowerPaths.some((p) => re.test(p));
  }

  /** How many paths match the regex? */
  count(re: RegExp): number {
    return this.lowerPaths.reduce((n, p) => (re.test(p) ? n + 1 : n), 0);
  }

  /** Content of the first file whose lowercased path ends with `nameLower`. */
  content(nameLower: string): string | undefined {
    for (const [p, c] of this.contentByLowerPath) {
      if (p === nameLower || p.endsWith("/" + nameLower)) return c;
    }
    return undefined;
  }
}

type Detector = (idx: RepoIndex, snap: RepoSnapshot, nowMs: number) => DimensionSignals;

// Small helper to accumulate score + evidence with a per-dimension cap of 100.
class Scorer {
  private score = 0;
  readonly signals: Signal[] = [];
  add(points: number, label: string, detail?: string) {
    this.score += points;
    this.signals.push({ label, detail });
  }
  note(label: string, detail?: string) {
    this.signals.push({ label, detail });
  }
  result(id: DimensionId): DimensionSignals {
    return { id, signalScore: clamp(Math.round(this.score)), signals: this.signals };
  }
}

// ---------------------------------------------------------------------------
// D1 — AI Tooling & Conventions
// ---------------------------------------------------------------------------
/**
 * Grade the *quality* of agent guidance (CLAUDE.md / AGENTS.md content), not just its
 * presence — this is where advanced AI-native technique shows up. Returns scored signals.
 *
 * Exported for Context Health (src/lib/analyze/context-health.ts — W4), which reuses these exact
 * graded signals as its display-only quality half so the two surfaces can never disagree about
 * what "good guidance" means. Its use THERE never feeds the score — only the D1 detector below does.
 */
export function guidanceQuality(text: string): { points: number; label: string }[] {
  const t = text.toLowerCase();
  const out: { points: number; label: string }[] = [];
  if (text.length >= 4000) out.push({ points: 8, label: "Detailed agent guidance (4k+ chars)" });
  else if (text.length >= 1200) out.push({ points: 5, label: "Substantial agent guidance" });
  if (
    /(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|dev|lint)|\bmake\s|pytest|go test|cargo (test|build)|##\s*(commands|build|test|scripts|development|getting started)/.test(t)
  )
    out.push({ points: 8, label: "Documents build/test/run commands" });
  if (/architect|directory structure|project structure|##\s*(overview|structure|layout)|how it works/.test(t))
    out.push({ points: 6, label: "Describes architecture / project structure" });
  if (/run (the )?tests?|after (making )?changes|before committing|verify your|definition of done|always test|make sure .* pass/.test(t))
    out.push({ points: 8, label: "Encodes test/verify-after-change discipline" });
  if (/\b(do not|don't|never|always|must not|avoid)\b|important:/.test(t))
    out.push({ points: 6, label: "Defines explicit constraints / rules" });
  if (/\bsubagent|sub-agent|\bmcp\b|model context protocol|\bhooks?\b|slash command|\bskills?\b|agents?\.md|\.cursor\b/.test(t))
    out.push({ points: 8, label: "References advanced agent tooling (MCP / hooks / subagents)" });
  if (/allowed[- ]?tools|disallowed|permission[- ]?mode|tool restriction/.test(t))
    out.push({ points: 4, label: "Specifies tool / permission policy" });
  if (/```|for example|e\.g\.|example:/.test(t)) out.push({ points: 4, label: "Includes concrete examples" });
  if (/@[a-z0-9_./-]+\.(md|ts|tsx|js|jsx|py)|@import|see \[[^\]]+\]\(/.test(t))
    out.push({ points: 4, label: "Uses file references / imports" });
  return out;
}

/**
 * Score adoption of the `.ai/` standard — and score it by EVIDENCE OF USE, not mere presence, so a
 * dropped-in empty scaffold can't game the rubric (the Goodhart guard). Presence earns a little; the
 * real points require the doctor to be *wired* into CI or a local hook (verified, not just sitting
 * there) and the memory store to be *used* beyond its seed entry. Split across D1 (the agent-facing
 * contract) and D8 (the executable harness + memory).
 */
function aiStandard(idx: RepoIndex): {
  d1: { points: number; label: string }[];
  d8: { points: number; label: string }[];
} {
  const d1: { points: number; label: string }[] = [];
  const d8: { points: number; label: string }[] = [];
  if (idx.has(/^\.ai\/manifest\.ya?ml$/)) {
    d1.push({ points: 2, label: "Found .ai/manifest.yaml (agent-facing contract)" });
    const m = idx.content(".ai/manifest.yaml") || "";
    if (/schema:\s*ai-manifest/.test(m) && /\ncapabilities:/.test(m) && /\ncontrols:/.test(m))
      d1.push({ points: 4, label: "Manifest declares capabilities + control placement" });
  }
  if (idx.has(/^\.ai\/doctor\.mjs$/)) {
    const lefthook = (idx.content("lefthook.yml") || idx.content("lefthook.yaml") || "").toLowerCase();
    const wired = /doctor\.mjs/.test(idx.workflowText) || /doctor\.mjs/.test(lefthook);
    d8.push(
      wired
        ? { points: 8, label: "Executable conformance (.ai/doctor.mjs) wired into CI/hook" }
        : { points: 2, label: ".ai/doctor.mjs present (not yet wired into CI/hook)" },
    );
  }
  const mem = idx.count(/^\.ai\/memory\/\d{4}-.*\.md$/);
  if (mem >= 2) d8.push({ points: 6, label: `Structured memory in use (.ai/memory, ${mem} entries)` });
  else if (mem === 1) d8.push({ points: 1, label: ".ai/memory seeded (not yet used)" });
  return { d1, d8 };
}

// The `.ai/` standard splits across D1 and D8, so both detectors call aiStandard(). The full body
// (manifest scan + doctor/hook wiring + memory count) is identical work for either half, and the two
// detectors run independently — so without memoization it runs twice per scan, each call discarding
// the half it doesn't need. Memo on the per-scan RepoIndex (immutable for the scan; matches the
// aiCommitFlags / loweredTreePaths pattern) so the second detector reads the cached result.
const aiStandardByIdx = new WeakMap<RepoIndex, ReturnType<typeof aiStandard>>();
function aiStandardCached(idx: RepoIndex): ReturnType<typeof aiStandard> {
  let r = aiStandardByIdx.get(idx);
  if (!r) {
    r = aiStandard(idx);
    aiStandardByIdx.set(idx, r);
  }
  return r;
}

const d1: Detector = (idx) => {
  const s = new Scorer();
  // Presence (reduced caps so guidance *quality* can contribute meaningfully).
  if (idx.has(/(^|\/)claude\.md$/)) s.add(22, "Found CLAUDE.md (Claude Code guidance)");
  if (idx.has(/(^|\/)agents?\.md$/)) s.add(16, "Found AGENTS.md (agent guidance)");
  if (idx.has(/(^|\/)\.cursorrules$/) || idx.has(/^\.cursor\/rules\//)) s.add(14, "Found Cursor rules");
  if (idx.has(/^\.github\/copilot-instructions\.md$/)) s.add(14, "Found Copilot instructions");
  if (idx.has(/(^|\/)(ai[-_]policy|ai[-_]tools|ai[-_]contributing|using[-_]ai)\.mdx?$/)) s.add(8, "Found an AI-usage policy/guide");
  if (idx.has(/(^|\/)\.aider\.conf\.ya?ml$/)) s.add(10, "Found Aider config");
  if (idx.has(/(^|\/)\.windsurfrules$/) || idx.has(/^\.windsurf\//)) s.add(10, "Found Windsurf rules");
  if (idx.has(/(^|\/)\.?mcp\.json$/) || idx.has(/(^|\/)mcp\.config\./)) s.add(10, "Found MCP server config");
  if (idx.has(/^\.claude\//)) s.add(8, "Found .claude/ directory");
  if (idx.has(/^(prompts|\.prompts)\//)) s.add(8, "Found a prompts/ library");
  if (idx.has(/(^|\/)\.continue\//) || idx.has(/(^|\/)\.clinerules/)) s.add(8, "Found Continue/Cline config");
  if (idx.has(/^\.devcontainer\//)) s.add(4, "Found devcontainer");

  // Content quality — substantive guidance with advanced patterns beats a token stub.
  const guidance = idx.content("claude.md") || idx.content("agents.md") || idx.content("agent.md");
  if (guidance) for (const g of guidanceQuality(guidance)) s.add(g.points, g.label);

  // The `.ai/` standard's agent-facing contract is high-signal machine-readable guidance.
  for (const g of aiStandardCached(idx).d1) s.add(g.points, g.label);

  if (s.signals.length === 0)
    s.note("No machine-readable AI/agent guidance detected", "e.g. CLAUDE.md, AGENTS.md, .cursorrules");
  return s.result("D1");
};

// ---------------------------------------------------------------------------
// D2 — Automated Testing
// ---------------------------------------------------------------------------
const TEST_PATH =
  /(^|\/)(__tests__|tests?|spec|e2e)\/|\.(test|spec)\.[a-z0-9]+$|_test\.[a-z0-9]+$|(^|\/)test_[^/]+\.py$|(^|\/)(test|tests|spec)\.[a-z0-9]+$/i;
const SOURCE_PATH =
  /\.(ts|tsx|js|jsx|py|go|rs|java|rb|kt|cs|php|swift|scala)$/i;
const VENDOR =
  /(^|\/)(node_modules|dist|build|vendor|\.next|out|target|\.venv)\//i;
// Non-core trees (examples, benchmarks, fixtures, docs sites, templates). A capability found ONLY here
// describes a sample/demo, not the repo's own pipeline — so delivery-as-code detection (D3) excludes
// them to avoid crediting an example app's DB migrations or an SDK's feature-flag product as the repo's.
const NONCORE =
  /(^|\/)(examples?|benches?|fixtures?|testdata|templates?|samples?|docs?)\//i;
// ADR / architecture-decision-record detection. ADRs count toward both D5 (Documentation) and D8
// (AI Process — agent-readable runbooks/ADRs), so single-source the path convention here rather than
// copy it into each detector (where one could be broadened and the other silently left behind).
const ADR_PATH = /(adr|decisions?)\/.*\.(md|mdx)$/;
const ADR_HINT = /architecture-decision/;

// D2 "assert nothing" penalty (G3-11): the fraction of a repo's total detected test files that must
// actually be in the content-sampled slice before the flat -15 fires. Below this, the sample is
// treated as too small/unlucky to indict the whole suite.
const MIN_SAMPLE_FRACTION = 0.3;

const d2: Detector = (idx) => {
  const s = new Scorer();
  const testFiles = idx.lowerPaths.filter((p) => TEST_PATH.test(p) && !VENDOR.test(p));
  const sourceFiles = idx.lowerPaths.filter(
    (p) => SOURCE_PATH.test(p) && !VENDOR.test(p) && !TEST_PATH.test(p),
  );
  const n = testFiles.length;

  if (n === 0) {
    // Rust doctests / Go tests can live inline in source with no test/ dir or *_test file the path
    // matcher catches — credit the suite when CI actually runs the test command (reference-scan P2-2).
    if (/cargo test|go test|\bpytest\b|npm test|make test/.test(idx.workflowText))
      s.add(20, "Tests run in CI (no separate test files matched)");
    else s.note("No test files detected");
  } else {
    const base = n >= 50 ? 50 : n >= 21 ? 42 : n >= 6 ? 32 : 20;
    s.add(base, `Found ${n} test file${n === 1 ? "" : "s"}`);
  }

  const frameworks = idx.manifestText + " " + idx.workflowText;
  if (
    /vitest|jest|mocha|pytest|unittest|go test|cargo test|gradle test|gotest|junit|rspec|phpunit|xunit|testify/.test(
      frameworks,
    ) ||
    idx.has(/(^|\/)(vitest\.config|jest\.config|pytest\.ini|conftest\.py)/)
  )
    s.add(15, "Test framework configured");
  if (/playwright|cypress|selenium|puppeteer/.test(frameworks) ||
    idx.has(/(^|\/)(playwright\.config|cypress\.config)/))
    s.add(15, "End-to-end tests configured");
  if (idx.has(/(^|\/)(codecov\.ya?ml|\.coveragerc)$/) || /--cov|nyc|coverage/.test(frameworks))
    s.add(10, "Coverage tracking configured");

  if (sourceFiles.length > 0 && n > 0) {
    const ratio = n / sourceFiles.length;
    if (ratio >= 0.5) s.add(15, "High test-to-source ratio", ratio.toFixed(2));
    else if (ratio >= 0.2) s.add(10, "Healthy test-to-source ratio", ratio.toFixed(2));
  }

  // Advanced testing rigor — these only show up in deliberately-engineered suites, so they
  // signal high maturity even though the cap keeps a thin suite from riding them to a top score.
  const adv = idx.manifestText + " " + idx.workflowText + " " + idx.pathText;
  if (/stryker|mutmut|\bpitest\b|cargo-mutants|\bmutant\b|mutation-testing/.test(adv))
    s.add(8, "Mutation testing configured");
  if (idx.has(/(^|\/)pacts?\//) || /@pact-foundation|pactflow|spring-cloud-contract/.test(adv))
    s.add(8, "Contract testing (Pact)");
  if (/\bk6\b|locust|artillery|gatling|jmeter|lighthouse-ci|\blhci\b/.test(adv))
    s.add(6, "Performance/load smoke tests");
  // Anchor to real a11y EVIDENCE, not a concept word in any tree path (maturity-model-scoring-engine #2):
  // a tool dep/config (axe-core/jest-axe/pa11y/cypress-axe), the term in the manifest/CI (`frameworks`),
  // or a path that is itself a TEST artifact (e.g. tests/a11y.spec.ts). Matching bare `accessibility`/
  // `a11y` against ALL paths credited a plain `AccessibilityMenu.tsx` (zero a11y tests) a false +6.
  if (
    /axe-core|jest-axe|\bpa11y\b|cypress-axe|@axe-core/.test(adv) ||
    /\ba11y\b|accessibility/.test(frameworks) ||
    testFiles.some((p) => /\ba11y\b|accessibility/.test(p))
  )
    s.add(6, "Accessibility tests");
  if (/schemathesis|\bdredd\b|@stoplight\/spectral|\bspectral\b|openapi.*(validate|lint)|\bprism\b/.test(adv))
    s.add(6, "API-schema validation");

  // Assertion-quality signal — read the SAMPLED test BODIES (within the MAX_FILES ingest budget) and
  // judge whether tests actually ASSERT behavior, not just exist. A high-count, assertion-free suite
  // (snapshot dumps, bodies that call code but never assert) must not reach the same band as a
  // behaviorally-tested one. We judge only what was fetched: with no test bodies in the sample we stay
  // neutral (never a false demotion from absence of data). `toMatchSnapshot`/bare `expect(` don't count
  // as substantive — a snapshot-only suite is exactly the vanity case this guards against.
  const sampledTestBodies = [...idx.contentByLowerPath]
    .filter(([p]) => TEST_PATH.test(p) && !VENDOR.test(p))
    .map(([, c]) => c);
  if (sampledTestBodies.length > 0) {
    const body = sampledTestBodies.join("\n");
    const cases = (body.match(/\b(it|test|describe|context)\s*\(|^\s*def\s+test_|\bfunc\s+Test[A-Z]|@Test\b|#\[test\]/gim) ?? []).length;
    const substantive = (
      body.match(
        // Adds testify (`require.NoError(`, `assert.Equal(` — the dot broke the bare `assert…` clause) to
        // the existing Jest/Go-testing.T/GoogleTest/`assert!` patterns (reference-scan P2-2).
        /\.(toBe|toEqual|toStrictEqual|toThrow|toContain|toHaveBeen[A-Za-z]*|toMatchObject|toBeGreaterThan|toBeLessThan|toBeCloseTo|toBeTruthy|toBeFalsy|toBeNull|toBeDefined|toBeInstanceOf|resolves|rejects)\b|\b(require|assert)\.[A-Za-z]\w*\s*\(|\bassert[A-Za-z_]*\s*[(!]|\bassert\s+\w|\bt\.(Error|Errorf|Fatal|Fatalf|Fail|is|deepEqual|truthy|throws)\b|\b(EXPECT|ASSERT)_[A-Z]/gi,
      ) ?? []
    ).length;
    // Minimum sampled-test coverage before the flat -15 penalty fires (G3-11): the ≤32-file ingest
    // budget can happen to sample only a small, unlucky slice of a repo's full test suite (e.g. 3 of
    // 40 test files, all snapshot-only) — penalizing the WHOLE suite off that slice isn't fair to a
    // repo that's well-tested elsewhere. Require the sample to cover at least MIN_SAMPLE_FRACTION of
    // the repo's total detected test files (`n`, from the untruncated path listing); below that,
    // downgrade to a neutral, non-scoring note rather than assert the full suite asserts nothing.
    const sampleFraction = n > 0 ? sampledTestBodies.length / n : 0;
    if (cases >= 4 && substantive === 0) {
      if (sampleFraction >= MIN_SAMPLE_FRACTION) {
        s.add(-15, "Sampled tests assert nothing", `${sampledTestBodies.length} sampled test file(s), ~${cases} cases, 0 substantive assertions — counting files, not behavior`);
      } else {
        s.note(
          `${sampledTestBodies.length} of ${n} test files sampled (~${Math.round(sampleFraction * 100)}%) show 0 substantive assertions — sample too small relative to the full suite to penalize`,
        );
      }
    } else if (substantive >= 4) {
      s.add(8, "Sampled tests assert behavior", `${substantive} substantive assertions across ${sampledTestBodies.length} sampled test file(s)`);
    }
  }

  return s.result("D2");
};

// ---------------------------------------------------------------------------
// D3 — CI/CD & Automation
// ---------------------------------------------------------------------------
const d3: Detector = (idx, snap) => {
  const s = new Scorer();
  const hasGha = idx.has(/^\.github\/workflows\/.+\.ya?ml$/);
  const otherCi = idx.has(
    /(^|\/)(\.gitlab-ci\.yml|\.circleci\/|azure-pipelines\.yml|jenkinsfile|\.travis\.yml|bitbucket-pipelines\.yml)/i,
  );
  // Off-GitHub CI / merge-queue evidence. World-class Go/Rust/systems repos gate on CI + code review
  // OUTSIDE GitHub Actions (Gerrit, bors/homu, Buildkite, LUCI), so a `.github/workflows`-only detector
  // scored them a false 0 ("No CI pipeline detected"). Read committed markers + commit-message trailers
  // (already in the snapshot) — the GHA path below stays byte-identical, so existing scores don't drift.
  const commitBlob = snap.commits.map((c) => c.message).join("\n").toLowerCase();
  const gerritCi = /reviewed-on:\s*https?:\/\/\S*(googlesource|gerrit)/.test(commitBlob) || /\nchange-id:\s*i[0-9a-f]{8,}/.test(commitBlob);
  const borsCi = idx.has(/(^|\/)bors\.toml$/) || /trybot-result:|\bbors r\+|\br=[a-z0-9._-]+/.test(commitBlob);
  const buildkiteCi = idx.has(/^\.buildkite\//);
  const genericCi = idx.has(/^\.ci\//) || idx.has(/(^|\/)(cloudbuild\.ya?ml|\.teamcity\/)/i);
  const offGhSystem = gerritCi ? "Gerrit" : borsCi ? "bors/merge-queue" : buildkiteCi ? "Buildkite" : genericCi ? "external CI" : null;

  if (hasGha) s.add(35, "GitHub Actions CI present");
  else if (otherCi) s.add(35, "CI pipeline present");
  else if (offGhSystem) s.add(35, `Off-GitHub CI detected (${offGhSystem})`, "review/build gate runs outside GitHub Actions");
  else s.note("No CI pipeline detected");

  const wfCount = idx.count(/^\.github\/workflows\/.+\.ya?ml$/);
  if (wfCount >= 2) s.add(10, `Multiple CI workflows (${wfCount})`);

  const wf = idx.workflowText;
  // For off-GitHub CI there is no workflow YAML, so the test/lint/build sub-signals below would read
  // empty and score 0. Fall back to the build tooling the gate invokes (Makefile/justfile/Taskfile) —
  // an off-GitHub gate with a `test`/`lint` target almost always runs it. Only consulted when GHA is
  // ABSENT, so GHA repos are unaffected.
  const buildScripts = offGhSystem
    ? ((idx.content("makefile") || "") + "\n" + (idx.content("justfile") || "") + "\n" + (idx.content("taskfile.yml") || idx.content("taskfile.yaml") || "")).toLowerCase()
    : "";
  if (/(npm|pnpm|yarn|bun) (run )?test|pytest|go test|cargo test|gradle test|jest|vitest/.test(wf))
    s.add(15, "CI runs tests");
  else if (offGhSystem && /go test|cargo test|pytest|npm test|make test|\btest:/.test(buildScripts))
    s.add(15, "CI runs tests", "inferred from build tooling invoked by the off-GitHub gate");
  if (/lint|eslint|ruff|flake8|golangci|prettier --check|biome/.test(wf))
    s.add(10, "CI runs linting");
  else if (offGhSystem && /golangci|clippy|go vet|ruff|eslint|\blint:/.test(buildScripts))
    s.add(10, "CI runs linting", "inferred from build tooling invoked by the off-GitHub gate");
  if (/(npm|pnpm|yarn|bun) (run )?build|go build|cargo build|gradle build|docker build/.test(wf))
    s.add(5, "CI runs a build");
  else if (offGhSystem && /go build|cargo build|make build|\bbuild:/.test(buildScripts))
    s.add(5, "CI runs a build", "inferred from build tooling invoked by the off-GitHub gate");

  if (
    idx.has(/(^|\/)(release-please|\.changeset\/|\.releaserc)/) ||
    /semantic-release|release-please|changesets|softprops\/action-gh-release/.test(
      wf + idx.manifestText,
    )
  )
    s.add(15, "Automated release tooling");
  if (/vercel|netlify|deploy|kubectl|aws |gcloud|fly deploy/.test(wf))
    s.add(15, "Automated deploy step");
  if (idx.has(/\.(tf|tf\.json)$/) || idx.has(/(^|\/)(cdk\.json|pulumi\.ya?ml|serverless\.yml)$/))
    s.add(10, "Infrastructure-as-Code present");

  // Delivery-as-code: a declarative, auditable, reversible path to production — what lets
  // autonomy compound (the L4→L5 jump). Scope to CORE paths (exclude examples/benches/fixtures/docs/
  // templates) so an example app's Prisma migrations or an SDK that *covers* feature-flags as a product
  // don't read as the repo's OWN pipeline, and require specific tool evidence over bare words like
  // "migrate"/"feature-flag"/"policy" — the reference-scan audit's D3 false-positive cluster (P1-3).
  const corePaths = idx.lowerPaths.filter((p) => !NONCORE.test(p) && !VENDOR.test(p));
  const deliver = corePaths.join(" ") + " " + idx.workflowText;
  if (corePaths.some((p) => /\.rego$/.test(p)) || /conftest|open-policy-agent|policy-as-code/.test(deliver))
    s.add(8, "Policy-as-code (OPA/conftest)");
  if (
    corePaths.some((p) => /(^|\/)(\.argocd|argocd|flux-system|clusters)\//.test(p)) ||
    /argoproj\.io|kind:\s*application\b|fluxcd|toolkit\.fluxcd\.io|kustomization\.ya?ml/.test(deliver)
  )
    s.add(8, "GitOps delivery (ArgoCD/Flux)");
  if (/argo-rollouts|kind:\s*rollout\b|flagger|launchdarkly|unleash|flagsmith|openfeature|split\.io/.test(deliver))
    s.add(8, "Progressive delivery / feature flags");
  if (
    corePaths.some((p) => /(^|\/)(migrations?|migrate)\/.+\.(sql|rb|py|ts|js|go)$/.test(p)) ||
    idx.has(/(^|\/)(alembic\.ini|liquibase\.properties)$/) ||
    /flyway|liquibase|alembic|prisma migrate|knex.*migrat|db:migrate|sequelize.*migrat/.test(deliver)
  )
    s.add(8, "Versioned DB migrations");

  return s.result("D3");
};

// ---------------------------------------------------------------------------
// D4 — Agentic Workflows (the high-maturity signal)
// ---------------------------------------------------------------------------
const d4: Detector = (idx, snap) => {
  const s = new Scorer();
  const wf = idx.workflowText;
  const blob = wf + " " + idx.pathText;

  // AI code-review agent — match a bot CONFIG file or a bot token in WORKFLOW YAML, not a bare token in
  // ANY tree path. The old all-paths match on generic words (`sweep`, `ellipsis`) false-fired on repos
  // with e.g. `runtime/mgcsweep.go` — crediting golang/go & rustc a phantom AI reviewer (reference-scan
  // P1-4). Scope the generic names to config files; keep unambiguous product tokens in workflow text.
  if (
    idx.has(/(^|\/)(\.coderabbit\.ya?ml|sweep\.ya?ml|\.qodo\.ya?ml|\.ellipsis\.ya?ml)$/) ||
    /coderabbit|claude-code-action|anthropics\/claude-code|greptile|pr-agent|qodo-ai|cubic-dev|ellipsis-dev/.test(wf)
  )
    s.add(35, "AI code-review agent in the pipeline");

  if (
    /anthropic_api_key|openai_api_key|gemini_api_key|google_api_key|anthropics\/|openai\b|claude|aws-actions\/.*bedrock/.test(
      wf,
    )
  )
    s.add(25, "LLM invoked inside CI");

  if (idx.has(/(^|\/)(autofix\.ci|\.autofix)/) || /autofix|pre-commit\.ci|lint.*--fix/.test(blob))
    s.add(15, "Automated fix/format bot");

  const depAuto =
    idx.content(".github/dependabot.yml") || idx.content("renovate.json") || "";
  if (/automerge|auto-merge/.test(depAuto.toLowerCase()) || /automerge/.test(blob))
    s.add(15, "Dependency auto-merge enabled");

  if (/issue.*comment|workflow_dispatch.*agent|peter-evans\/create-pull-request/.test(wf))
    s.add(15, "Issue/PR automation workflow");

  if (idx.has(/(^|\/)\.github\/dependabot\.yml$/) || idx.has(/(^|\/)renovate\.json$/))
    s.add(10, "Dependency update bot configured");
  // Behavioral fallback: the bot is often enabled at the org/App level with NO committed config, yet
  // its commits flood the history — crediting them resolves the D4↔D9 "no dependency tool" contradiction
  // (reference-scan P1-2). Slightly lower than a committed config (less auditable in-repo).
  else if (snap && hasDependencyBotCommits(snap))
    s.add(8, "Dependency update bot active (org/App-level, no committed config)");

  if (s.signals.length === 0)
    s.note("No agentic/AI-in-CI workflows detected", "e.g. AI review bots, LLM steps in CI, auto-merge");
  return s.result("D4");
};

/** Renovate/Dependabot fingerprints in recent commits — the behavioral signal that a dependency-update
 *  bot is active even with no committed config (org/App-level enablement). Shared by D4 + the D9 battery. */
export function hasDependencyBotCommits(snap: RepoSnapshot): boolean {
  let n = 0;
  for (const c of snap.commits) {
    const login = c.authorLogin ?? "";
    if (/dependabot(\[bot\])?$|renovate(-[\w-]+)?(\[bot\])?$/i.test(login) || /^(chore|build|fix)\(deps\)|^bumps? \[?\S+\]? from |^update \S+ (from|to) /i.test(c.message)) {
      if (++n >= 2) return true; // require a couple so a one-off "update readme" doesn't qualify
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// D5 — Documentation & Knowledge
// ---------------------------------------------------------------------------
const d5: Detector = (idx) => {
  const s = new Scorer();
  const readme = idx.content("readme.md") || idx.content("readme") || idx.content("readme.rst");
  if (readme) {
    // Count ATX (`## `), HTML (`<h2>`), and Setext (underline) headers — the section counter used to
    // read only ATX, so HTML/Setext READMEs reported "0 sections" (reference-scan P2-3).
    const headings =
      (readme.match(/^#{1,3} /gm) || []).length +
      (readme.match(/<h[1-6][\s>]/gi) || []).length +
      (readme.match(/^[^\n]+\r?\n(={3,}|-{3,})\s*$/gm) || []).length;
    if (readme.length >= 1500) s.add(30, "Substantial README", `${readme.length} chars, ${headings} sections`);
    else s.add(15, "README present", `${readme.length} chars`);
  } else {
    s.note("No README detected");
  }

  if (idx.count(/^docs?\/.*\.(md|mdx|rst)$/) >= 2 || idx.count(/(^|\/)apps\/docs\//) >= 1)
    s.add(20, "Dedicated /docs with multiple pages");
  if (idx.has(/(^|\/)llms(-full)?\.(txt|md)$/)) s.add(5, "LLM-readable docs (llms.txt)");
  if (idx.has(ADR_PATH) || idx.has(ADR_HINT))
    s.add(15, "Architecture Decision Records");
  if (idx.has(/(^|\/)contributing\.md$/)) s.add(10, "CONTRIBUTING.md");
  if (idx.has(/(^|\/)changelog\.md$/) || idx.has(/^\.changeset\//)) s.add(10, "Changelog");
  if (idx.has(/(^|\/)(openapi|swagger)\.(ya?ml|json)$/) || idx.has(/typedoc\.json$/))
    s.add(10, "API documentation");
  if (idx.has(/^examples?\//)) s.add(5, "Examples directory");
  return s.result("D5");
};

// ---------------------------------------------------------------------------
// D6 — Code Quality & Guardrails
// ---------------------------------------------------------------------------
/**
 * Off-platform code review (Gerrit / bors merge-queue) leaves trailers in commit messages even though
 * GitHub's PR/review API reports 0% — so crediting it stops the "0% reviewed / nothing stops a merge"
 * narrative firing on projects (golang, rust) whose review gate is stricter than any GitHub-native
 * setup. Shared by the D6 detector (positive signal) and applyPrSignals (suppress the misleading drag).
 */
export function offPlatformReview(commits: { message: string }[]): string | null {
  const blob = commits.map((c) => c.message).join("\n").toLowerCase();
  if (/reviewed-on:\s*https?:\/\/\S*(googlesource|gerrit)/.test(blob) || /\nchange-id:\s*i[0-9a-f]{8,}/.test(blob)) return "Gerrit";
  if (/trybot-result:|\bbors r\+|\br=[a-z0-9._-]+\b/.test(blob)) return "bors/merge-queue";
  return null;
}

const d6: Detector = (idx, snap) => {
  const s = new Scorer();
  const linterConfigured =
    idx.has(/(^|\/)(\.eslintrc|eslint\.config)\.[a-z]+$/) ||
    idx.has(/(^|\/)(ruff\.toml|biome\.json|\.golangci\.ya?ml|\.rubocop\.yml)$/) ||
    /eslint|ruff|biome|golangci|rubocop|flake8/.test(idx.manifestText);
  if (linterConfigured) s.add(20, "Linter configured");

  if (
    idx.has(/(^|\/)\.prettierrc/) ||
    idx.has(/(^|\/)(\.editorconfig)$/) ||
    /prettier|black|gofmt|rustfmt/.test(idx.manifestText)
  )
    s.add(10, "Formatter configured");

  // Guardrails enforced INLINE in CI — the Rust/Go norm (e.g. `cargo clippy -D warnings`, `go vet`,
  // `ruff check`, `tsc --noEmit` run in a workflow) with no standalone config file. Detected #1 gap in
  // the reference-scan audit: D6 used to read only config files + manifests, so it scored 0 and even
  // contradicted D3's own "CI runs linting" on the same repo. Credit the full 20 when no standalone
  // linter config was found (the gap this closes), else a small top-up (both config + CI enforcement).
  const ciGuardrail =
    /cargo clippy|cargo fmt|rustfmt|go vet|staticcheck|golangci-lint|ruff (check|format)|\bmypy\b|pyright|\bty check\b|eslint|biome (check|ci|lint)|prettier --check|tsc\b[^\n]*--noemit|--no-?emit|npm run (lint|typecheck|check)|(pnpm|yarn) (lint|typecheck|check)|make (lint|fmt|format|check)|task (lint|check)|taplo|spotless|treefmt/.test(
      idx.workflowText,
    );
  if (ciGuardrail) s.add(linterConfigured ? 5 : 20, linterConfigured ? "Guardrails also enforced in CI" : "Lint/format/type-check enforced in CI");

  const tsconfig = idx.content("tsconfig.json") || "";
  if (/"strict"\s*:\s*true/.test(tsconfig)) s.add(20, "TypeScript strict mode");
  else if (tsconfig) s.add(10, "TypeScript configured");
  else if (idx.has(/(^|\/)(mypy\.ini|\.mypy\.ini)$/) || /mypy|pyright/.test(idx.manifestText))
    s.add(15, "Static type checking (mypy/pyright)");

  if (
    idx.has(/(^|\/)\.pre-commit-config\.ya?ml$/) ||
    idx.has(/^\.husky\//) ||
    /lint-staged|husky|pre-commit/.test(idx.manifestText)
  )
    s.add(15, "Pre-commit hooks");

  if (idx.has(/(^|\/)codeowners$/)) s.add(15, "CODEOWNERS");
  // Off-platform review gate (Gerrit / bors) — real review discipline GitHub's PR API can't see.
  const offReview = offPlatformReview(snap.commits);
  if (offReview) s.add(15, `Code review via off-platform gate (${offReview})`, "commit trailers show mandatory pre-merge review");
  if (idx.has(/(^|\/)(commitlint\.config|\.commitlintrc)/) || /commitlint|conventional/.test(idx.manifestText))
    s.add(10, "Commit linting / conventions");
  if (idx.has(/(^|\/)(pull_request_template|\.github\/pull_request_template)/i))
    s.add(5, "PR template (review process)");

  // (Supply-chain security — SAST/SCA/secret/container scanning, SBOM, signing — is scored
  // under D9, not here, so a security-heavy repo isn't double-counted.)
  if (s.signals.length === 0) s.note("No linting/typing/guardrail config detected");
  return s.result("D6");
};

// ---------------------------------------------------------------------------
// D7 — Commit & Velocity Signals
// ---------------------------------------------------------------------------
// The whole trailer vocabulary — key phrases (co-authored-by / assisted-by) AND the tool-name
// alternation — is sourced from ai-tools.ts (AI_TRAILER_SOURCE), so commit-level and PR-level
// trailer attribution can never drift apart (W2).
const AI_TRAILER = new RegExp(AI_TRAILER_SOURCE, "i");
const CONVENTIONAL =
  /^(feat|fix|chore|docs|refactor|test|build|ci|perf|style|revert)(\(.+\))?!?:/i;

// Single source of truth for "is this commit AI/bot-attributed". Previously this exact test was
// copy-pasted in d7, detectAiUsage, and computeContributors — if one copy's regex was updated the
// others silently drifted. One predicate keeps the rule consistent everywhere.
function isAiCommit(c: { message: string; authorLogin?: string | null }): boolean {
  return AI_TRAILER.test(c.message) || /\[bot\]$/i.test(c.authorLogin ?? "");
}

// Per-snapshot derivation memos. The AI-attribution pass over commits and the lowercased full
// tree are each computed once per RepoSnapshot and shared across every consumer (d7 / detectAiUsage
// / computeContributors / classifyArchetype) instead of being re-derived 3-4x. Keyed by the
// immutable snapshot object, so memory is reclaimed with the snapshot and stale reuse is impossible.
const aiFlagsBySnap = new WeakMap<RepoSnapshot, boolean[]>();
function aiCommitFlags(snap: RepoSnapshot): boolean[] {
  let flags = aiFlagsBySnap.get(snap);
  if (!flags) {
    flags = snap.commits.map(isAiCommit);
    aiFlagsBySnap.set(snap, flags);
  }
  return flags;
}

const loweredTreeBySnap = new WeakMap<RepoSnapshot, string[]>();
function loweredTreePaths(snap: RepoSnapshot): string[] {
  let paths = loweredTreeBySnap.get(snap);
  if (!paths) {
    paths = snap.tree.map((t) => t.path.toLowerCase());
    loweredTreeBySnap.set(snap, paths);
  }
  return paths;
}

const d7: Detector = (idx, snap, nowMs) => {
  const s = new Scorer();
  const commits = snap.commits;
  if (commits.length === 0) {
    s.note("No commit history available", "could not read recent commits");
    return s.result("D7");
  }

  s.add(5, `${commits.length} recent commits analyzed`);

  // Adoption credit keys on GENUINE AI authorship (an AI co-author trailer), NOT routine automation bots
  // (Renovate/Dependabot/Speakeasy) that also carry a [bot] login — counting the latter inflated the
  // "AI-native" signal on repos whose only bot activity was dependency bumps (reference-scan P2-4). The
  // full bot+AI count still drives per-contributor attribution (computeContributors) and is noted below.
  const genuineAi = commits.filter((c) => AI_TRAILER.test(c.message)).length;
  const botOrAi = aiCommitFlags(snap).filter(Boolean).length;
  const aiFrac = genuineAi / commits.length;
  if (aiFrac >= 0.3) s.add(30, "Frequent AI-assisted commits", `${Math.round(aiFrac * 100)}%`);
  else if (genuineAi > 0) s.add(15, "AI-assisted commits present", `${genuineAi} of ${commits.length}`);
  else if (botOrAi > 0) s.note("Automation-bot commits present (not AI-assisted authorship)", `${botOrAi} of ${commits.length}`);

  // Commit hygiene now carries more weight than mere AI attribution.
  const convCommits = commits.filter((c) => CONVENTIONAL.test(c.message.split("\n")[0] ?? "")).length;
  const convFrac = convCommits / commits.length;
  if (convFrac >= 0.5) s.add(35, "Conventional commit style", `${Math.round(convFrac * 100)}%`);
  else if (convFrac >= 0.2) s.add(20, "Some conventional commits", `${Math.round(convFrac * 100)}%`);

  if (commits.length >= 10) s.add(10, "Active commit cadence");

  if (snap.meta.pushedAt) {
    // Use the injected scan timestamp (not Date.now) so the same snapshot re-scored later
    // yields the same D7 — keeping scores reproducible and trend comparisons honest.
    // Guard the parsed pushedAt the same way nowMs is guarded above: a malformed / non-ISO
    // value would otherwise make ageDays NaN, `NaN <= 30` false, and silently void the bonus.
    const pushedMs = new Date(snap.meta.pushedAt).getTime();
    if (Number.isFinite(pushedMs)) {
      const ageDays = (nowMs - pushedMs) / 86_400_000;
      if (ageDays <= 30) s.add(15, "Actively maintained", "pushed within 30 days");
    } else {
      s.note("Last-push date unreadable", "recency bonus skipped — malformed pushedAt");
    }
  }

  return s.result("D7");
};

// ---------------------------------------------------------------------------
// D8 — AI Process & Harness (is AI used *properly* in development, not ad hoc?)
// ---------------------------------------------------------------------------
const d8: Detector = (idx) => {
  const s = new Scorer();
  const blob = idx.allText;

  // Evals / golden tests for AI/LLM output.
  if (
    idx.has(/(^|\/)(evals?|\.?promptfoo|golden)\//) ||
    idx.has(/(^|\/)promptfoo\.(ya?ml|json)$/) ||
    // Anchor to real eval EVIDENCE (maturity-model-scoring-engine #2): a dedicated evals//golden/ dir or
    // promptfoo config (checked above), or a SPECIFIC eval-tool token. The bare `\bevals?\b` was DROPPED
    // — against all tree paths it credited a plain `src/eval.ts` (or a `json-eval` dep) a 30-point lift
    // from a filename: the single biggest false signal on the keyless/mock demo path.
    /promptfoo|llm[\s-]?eval|golden[\s-]?test/.test(blob)
  )
    s.add(30, "AI-output eval / golden-test harness");

  // Structured prompt / agent / skill library. A committed `.claude/skills/` (or `.agents/skills/`)
  // is a mandatory, named skill library — the same high-signal harness as a prompts/ dir (P1-4).
  if (
    idx.has(/^(prompts|\.prompts)\//) ||
    idx.count(/^\.claude\/agents\//) >= 1 ||
    idx.count(/^\.(claude|agents)\/skills?\//) >= 1 ||
    idx.count(/(^|\/)agents?\//) >= 2
  )
    s.add(25, "Structured prompt / agent / skill library");

  // Agent-readable operational docs / runbooks / ADRs.
  if (
    idx.has(/(^|\/)(runbooks?|docs\/agents?|docs\/runbooks?)\//) ||
    idx.has(ADR_PATH) ||
    idx.has(ADR_HINT)
  )
    s.add(20, "Agent-readable runbooks / ADRs");

  // AI contribution process (review gate / DoD).
  const contributing = (idx.content("contributing.md") || "").toLowerCase();
  if (
    idx.has(/(^|\/)(pull_request_template|\.github\/pull_request_template)/) ||
    idx.has(/(^|\/)(ai[-_]policy|ai[-_]tools|ai[-_]contributing)\.mdx?$/) ||
    /definition of done|ai[- ]generated|co-?authored|agent/.test(contributing)
  )
    s.add(15, "AI contribution process (PR template / DoD / AI policy)");

  // Structured tickets (Plan & Design): issue templates with acceptance criteria / DoD give an
  // agent a well-formed task to work from, not a one-line prompt.
  if (idx.has(/^\.github\/issue_template(\/|\.)/) || idx.has(/^\.github\/issue_template$/))
    s.add(10, "Structured issue templates");

  // The `.ai/` standard's executable conformance + structured memory — scored by evidence of use.
  for (const g of aiStandardCached(idx).d8) s.add(g.points, g.label);

  if (s.signals.length === 0)
    s.note("No dedicated AI process/harness detected", "e.g. evals, prompt library, agent runbooks");
  return s.result("D8");
};

// ---------------------------------------------------------------------------
// D9 — Supply Chain & Security (shift-left security as code)
// ---------------------------------------------------------------------------
const d9: Detector = (idx) => {
  const s = new Scorer();
  const blob = idx.allText;
  const hasContainer = idx.has(/(^|\/)(dockerfile|containerfile)$/) || idx.has(/(^|\/)docker-compose\.ya?ml$/);

  // SAST — static analysis of first-party code.
  if (
    idx.has(/^\.github\/workflows\/.*codeql/i) ||
    idx.has(/(^|\/)(sonar-project\.properties|\.semgrep\.ya?ml)$/) ||
    /codeql|github\/codeql-action|semgrep|sonarqube|sonarcloud|sonarsource|snyk code/.test(blob)
  )
    s.add(25, "Static analysis (SAST) in the pipeline");

  // Dependency / SCA scanning + license compliance. Renovate has several config locations
  // (renovate.json[5], .renovaterc[.json], .github/renovate.json) and tools may sit as a
  // dotfile (.snyk, osv-scanner.toml) rather than a workflow step.
  if (
    idx.has(/(^|\/)\.github\/dependabot\.yml$/) ||
    idx.has(/(^|\/)(\.?renovaterc(\.json)?|renovate\.json5?)$/) ||
    idx.has(/(^|\/)(\.snyk|osv-scanner\.toml)$/) ||
    /snyk|osv-scanner|google\/osv|npm audit|pip-audit|cargo audit|bundler-audit|dependency-check|fossa|license-checker/.test(
      blob,
    )
  )
    s.add(20, "Dependency/SCA & license scanning");

  // Secret scanning.
  if (/gitleaks|trufflehog|detect-secrets|ggshield|gitguardian|secretlint/.test(blob))
    s.add(15, "Secret scanning");

  // Container image vulnerability scanning (only meaningful when something is containerized).
  if (hasContainer && /trivy|grype|\bclair\b|anchore|docker scout|snyk container/.test(blob))
    s.add(10, "Container image vulnerability scan");

  // SBOM generation.
  if (/syft|cyclonedx|spdx|sbom|anchore\/sbom-action/.test(blob))
    s.add(12, "SBOM generation");

  // Artifact signing / provenance attestation (SLSA).
  if (/cosign|sigstore|slsa-framework|slsa-github-generator|in-toto|actions\/attest|provenance/.test(blob))
    s.add(12, "Artifact signing / SLSA provenance");

  // Security policy + threat modeling (Plan & Design security requirements).
  if (idx.has(/(^|\/)security\.md$/)) s.add(6, "SECURITY.md policy");
  if (idx.has(/threat[-_ ]?model/) || /threat model|stride|attack tree|trust boundary/.test(blob))
    s.add(8, "Threat-model documentation");

  if (s.signals.length === 0)
    s.note("No supply-chain security tooling detected", "e.g. CodeQL/Semgrep, Dependabot/Snyk, gitleaks, SBOM, cosign");
  return s.result("D9");
};

// Detectors paired with their dimension id, so a crash can still yield a correctly-labeled
// neutral result for the dimension it was meant to score.
const DETECTORS: { id: DimensionId; fn: Detector }[] = [
  { id: "D1", fn: d1 },
  { id: "D2", fn: d2 },
  { id: "D3", fn: d3 },
  { id: "D4", fn: d4 },
  { id: "D5", fn: d5 },
  { id: "D6", fn: d6 },
  { id: "D7", fn: d7 },
  { id: "D8", fn: d8 },
  { id: "D9", fn: d9 },
];

/**
 * Run all deterministic detectors over a snapshot.
 *
 * `now` (ISO timestamp) is threaded into the detectors so signal extraction is a *pure*
 * function of the snapshot (D7's recency bonus no longer reads the wall clock); it defaults
 * to the current time only when omitted.
 *
 * Each detector is isolated: if one throws on a pathological repo file it yields a neutral
 * zero-score result plus a warning (pushed to `warnings` if provided) instead of aborting the
 * whole scan — this deterministic layer is the reliable fallback, so it must degrade to a
 * partial result rather than no score at all.
 */
export function analyzeSignals(
  snap: RepoSnapshot,
  now?: string,
  warnings?: string[],
): DimensionSignals[] {
  const idx = new RepoIndex(snap);
  const parsed = now ? new Date(now).getTime() : NaN;
  const nowMs = Number.isNaN(parsed) ? Date.now() : parsed;

  return DETECTORS.map(({ id, fn }) => {
    try {
      return fn(idx, snap, nowMs);
    } catch (err) {
      const msg = `Detector ${id} failed and was skipped (scored 0) — other dimensions are unaffected.`;
      warnings?.push(msg);
      console.error(`[analyze] ${msg}`, err);
      return {
        id,
        signalScore: 0,
        failed: true,
        signals: [
          { label: "Signal extraction failed for this dimension", detail: "scored 0; other dimensions unaffected" },
        ],
      };
    }
  });
}

/**
 * "Is AI in the workflow?" — surfaced as an indicator separate from the maturity score,
 * so the fact that AI is used isn't conflated with how AI-native the engineering is.
 */
export function detectAiUsage(snap: RepoSnapshot, prStats?: PrStats | null): AiUsage {
  const commits = snap.commits;
  const botOrAi = aiCommitFlags(snap).filter(Boolean).length;
  const frac = commits.length ? botOrAi / commits.length : 0;
  // GENUINE AI-authored commits (an AI co-author trailer) — distinct from routine automation bots
  // (Dependabot/Renovate) that also carry a `[bot]` login. Conflating the two made `detected` fire on
  // a repo whose only "AI" was Renovate version bumps (the reference-scan audit's spurious "71% AI").
  const genuineAi = commits.filter((c) => AI_TRAILER.test(c.message)).length;
  const lowerPaths = loweredTreePaths(snap);
  const hasTooling = lowerPaths.some((p) =>
    /(^|\/)(claude\.md|agents?\.md|\.cursorrules|copilot-instructions\.md)$/.test(p) ||
    /^\.(claude|cursor|windsurf)\//.test(p),
  );
  // The AUTHORITATIVE AI signal is PR-level involvement with tool attribution (Claude/Cursor/Copilot),
  // not the bot-commit fraction (which ≈ the Renovate/Dependabot rate). Fold it in when PR stats exist.
  const aiInPrs = prStats && prStats.aiInvolvedRate > 0 ? prStats.aiInvolvedRate : 0;

  const signals: string[] = [];
  if (aiInPrs > 0) {
    const tools = prStats?.tools?.length ? ` (${prStats.tools.map((t) => `${t.name} ${t.count}`).join(", ")})` : "";
    signals.push(`AI involved in ${aiInPrs}% of recent PRs${tools}`);
  }
  if (hasTooling) signals.push("AI/agent guidance committed to the repo");
  if (genuineAi > 0) signals.push(`${genuineAi}/${commits.length} commits carry an AI co-author trailer`);
  const bots = botOrAi - genuineAi;
  if (bots > 0) signals.push(`${bots}/${commits.length} commits are bot-authored (automation, not AI coding)`);

  // `detected` now requires REAL evidence of AI-assisted development — PR-level AI, committed agent
  // guidance, or a genuine AI co-author trailer — NOT the bot-commit fraction (the old false positive).
  const detected = aiInPrs > 0 || hasTooling || genuineAi > 0;
  return { detected, commitFraction: Math.round(frac * 100) / 100, signals };
}

/** Aggregate recent commits by author, tracking AI-attributed commits per contributor. */
export function computeContributors(snap: RepoSnapshot): Contributor[] {
  const map = new Map<string, Contributor>();
  const flags = aiCommitFlags(snap);
  snap.commits.forEach((c, i) => {
    const login = c.authorLogin || c.authorName || "unknown";
    const e =
      map.get(login) ??
      ({ login, name: c.authorName, commits: 0, aiCommits: 0, lastActiveAt: undefined } as Contributor);
    e.commits += 1;
    if (flags[i]) e.aiCommits += 1;
    if (c.committedAt && (!e.lastActiveAt || c.committedAt > e.lastActiveAt)) e.lastActiveAt = c.committedAt;
    if (!e.name && c.authorName) e.name = c.authorName;
    map.set(login, e);
  });
  return [...map.values()].sort((a, b) => b.commits - a.commits);
}

/**
 * Infer how the repo is RUN, to pick a fair weighting lens — from signals already in the snapshot
 * (no extra API calls). The lens exists so single-author work is judged fairly rather than dragged
 * to L1–L2 for lacking infrastructure it doesn't need (model.ts ARCHETYPE_WEIGHTS), so the heuristic
 * must measure run-style, not popularity.
 *
 * Recorded reasoning for the thresholds (ambiguity-ui maturity-model #5 — previously bare magic
 * numbers, and stars alone forced the org lens onto viral solo repos):
 *  - CODEOWNERS + ≥2 CI workflows is DIRECT evidence of org-scale process → org, regardless of stars.
 *  - Stars are only a popularity PROXY for run-style (chosen originally because they're free — no
 *    extra API call). 1000 ≈ "visible enough that platform/org expectations are reasonable";
 *    50 ≈ "has an audience beyond the author". Both remain judgment calls, so star-driven
 *    escalation is now CORROBORATED against the contributor evidence the snapshot already carries:
 *  - ≤2 distinct human authors in the recent-commit window caps a star-driven "org" at "team" — a
 *    viral single-maintainer repo (a very common OSS shape) is still run like solo/team work, and
 *    the org lens would double D3 (0.07→0.14) and more-than-double D9 (0.04→0.09) against it.
 *    An empty commit window means author count is UNKNOWN (shallow ingest) — fall back to the star
 *    heuristic rather than capping on missing data. Bot authors ([bot] logins) don't count.
 */
export function classifyArchetype(snap: RepoSnapshot): RepoArchetype {
  const paths = loweredTreePaths(snap);
  const hasCodeowners = paths.some((p) => /(^|\/)codeowners$/.test(p));
  const workflows = paths.filter((p) => /^\.github\/workflows\/.+\.ya?ml$/.test(p)).length;
  const stars = snap.meta.stars ?? 0;
  const humanAuthors = new Set(
    snap.commits
      .map((c) => c.authorLogin || c.authorName || "")
      .filter((a) => a && !/\[bot\]$/i.test(a)),
  ).size;
  const authorsKnown = snap.commits.length > 0;
  if (hasCodeowners && workflows >= 2) return "org";
  if (stars >= 1000) return authorsKnown && humanAuthors <= 2 ? "team" : "org";
  if (stars >= 50 || hasCodeowners || workflows >= 1) return "team";
  return "solo";
}
