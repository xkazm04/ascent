// Resolve a scan's DETECTED TECH STACK into the concrete, repo-specific material an onboarding track
// needs — the commands to run, the coverage/CI recipe to wire, and the per-dimension notes a given
// framework makes actionable.
//
// Why this exists: the per-dimension control matrix in `tracks.ts` is a static 9×3 grid, so two repos
// with the same weak dimensions and the same primary language used to get BYTE-IDENTICAL instructions
// — even when one is a Next.js app and the other a Terraform module set. The scan already carries the
// answer (`report.techStack`: languages, frameworks, roles, from analyze/tech-extract) and it sat
// unused. This module turns it into divergence.
//
// Pure + deterministic (no LLM, no I/O). DEGRADES, never throws: `techStack` is absent on older
// persisted rows (Scan.techStackJson was null before the column shipped, and the reconstructed
// keyless path never sets it), so every read is optional-chained and the output falls back to exactly
// today's language-only behavior.

import type { DimensionId, ScanReport, StackRole, TechStack } from "@/lib/types";
import { commandsFor, hasConcreteCommands, type LangCommands } from "@/lib/practice-artifact";

/** Everything the track builder needs to know about THIS repo's stack. */
export interface StackContext {
  /** The language the commands resolved from — null when nothing in the stack was recognized. */
  language: string | null;
  commands: LangCommands;
  /** True when `commands` are real (not the `<run tests>` placeholder tuple). */
  concrete: boolean;
  /** Detected frameworks / notable tools, most-notable first (empty when techStack is absent). */
  frameworks: string[];
  roles: StackRole[];
}

/** Tolerant, defensive read of a persisted TechStack — an older row may be missing it entirely, and a
 *  hand-edited/partial blob may be missing individual arrays. Never throws. */
function safeStack(ts: TechStack | undefined): { frameworks: string[]; roles: StackRole[]; languages: string[]; backendLanguage?: string } {
  return {
    frameworks: Array.isArray(ts?.frameworks) ? ts.frameworks.filter((f) => typeof f === "string") : [],
    roles: Array.isArray(ts?.roles) ? ts.roles.filter((r) => typeof r === "string") : [],
    languages: Array.isArray(ts?.languages) ? ts.languages.filter((l) => typeof l === "string") : [],
    ...(typeof ts?.backendLanguage === "string" ? { backendLanguage: ts.backendLanguage } : {}),
  };
}

/**
 * Resolve the repo's stack. Command resolution walks candidates in confidence order — GitHub's primary
 * language first (it is what the old behavior used, so a recognized primary language is byte-stable),
 * then the manifest-derived `techStack.languages`, then the backend language. That last-resort walk is
 * what rescues a repo whose GitHub primary language is a non-buildable one (HTML/Shell/Dockerfile) but
 * whose manifests clearly say "Python" — it used to fall through to `<run tests>` placeholders.
 */
export function resolveStack(report: ScanReport): StackContext {
  const ts = safeStack(report.techStack);
  const frameworks = ts.frameworks;
  const roles = ts.roles;
  const candidates = [report.repo.primaryLanguage, ...ts.languages, ts.backendLanguage];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const commands = commandsFor(candidate);
    if (hasConcreteCommands(commands)) return { language: candidate, commands, concrete: true, frameworks, roles };
  }
  return { language: null, commands: commandsFor(null), concrete: false, frameworks, roles };
}

// ── Coverage / CI recipes ─────────────────────────────────────────────────────────────────────────
// No markdown backticks in any of these strings: skill.ts renders the whole deliverable path as one
// code span, so an inner backtick would create a broken nested span.

type CiKind = LangCommands["ci"];

const COVERAGE_BY_CI: Record<CiKind, string> = {
  node: "vitest --coverage thresholds in vitest.config (or jest coverageThreshold)",
  python: "pytest --cov with --cov-fail-under in pyproject.toml",
  go: "go test -coverprofile + a coverage-threshold check",
  rust: "cargo llvm-cov (or tarpaulin) with a min-coverage threshold",
  generic: "a coverage threshold for your test runner",
};

const CI_SETUP_BY_CI: Record<CiKind, string> = {
  node: "setup-node",
  python: "setup-python",
  go: "setup-go",
  rust: "rust-toolchain",
  generic: "the language setup step",
};

/** Coverage recipes for the extended (ci: "generic") language families, keyed by lowercased language. */
const COVERAGE_BY_LANGUAGE: Record<string, string> = {
  ruby: "SimpleCov with a minimum_coverage floor in spec_helper",
  php: "phpunit --coverage-text with a min-coverage check",
  java: "JaCoCo with a check rule bound to the verify phase",
  kotlin: "JaCoCo (or Kover) with a gradle coverage verification rule",
  scala: "sbt-scoverage with coverageMinimumStmtTotal",
  "c#": "coverlet + ReportGenerator with a threshold",
  csharp: "coverlet + ReportGenerator with a threshold",
  swift: "swift test --enable-code-coverage + an xcov threshold",
  dart: "dart test --coverage with a lcov threshold check",
  elixir: "excoveralls with a minimum_coverage in coveralls.json",
};

/** Coverage recipes a FRAMEWORK makes more concrete than its language alone (checked first). */
const COVERAGE_BY_FRAMEWORK: Record<string, string> = {
  "Next.js": "vitest --coverage over app/ route handlers + server actions, thresholds in vitest.config",
  Flutter: "flutter test --coverage with a lcov floor",
  Android: "./gradlew jacocoTestReport with a coverage verification rule",
  Django: "pytest-django with --cov and --cov-fail-under in pyproject.toml",
  Rails: "SimpleCov with a minimum_coverage floor in rails_helper",
  Terraform: "terraform test + checkov coverage over every module",
  Jupyter: "nbval (or papermill smoke runs) so notebooks are executed, not just linted",
};

/** Framework-specific BUILD/verify step to append to the CI recipe (D3). */
const BUILD_BY_FRAMEWORK: Record<string, string> = {
  "Next.js": "next build",
  Nuxt: "nuxt build",
  Astro: "astro build",
  Angular: "ng build --configuration production",
  Flutter: "flutter build",
  Android: "./gradlew assembleRelease",
  Django: "python manage.py check --deploy",
  Rails: "bundle exec rails zeitwerk:check",
  Terraform: "terraform validate",
  Helm: "helm lint",
  Kubernetes: "kubectl apply --dry-run=server",
};

/** The first detected framework that has an entry in `table`, or null. */
function firstHit<T>(frameworks: string[], table: Record<string, T>): T | null {
  for (const f of frameworks) {
    const hit = table[f];
    if (hit !== undefined) return hit;
  }
  return null;
}

/** The coverage recipe for this stack — framework-specific if we know one, else language, else CI family. */
export function coverageHint(stack: StackContext): string {
  return (
    firstHit(stack.frameworks, COVERAGE_BY_FRAMEWORK) ??
    COVERAGE_BY_LANGUAGE[(stack.language ?? "").toLowerCase()] ??
    COVERAGE_BY_CI[stack.commands.ci]
  );
}

/** The GitHub Actions setup step for this stack (the extended families carry theirs on `ciSetup`). */
export function ciSetupHint(stack: StackContext): string {
  return stack.commands.ciSetup ?? CI_SETUP_BY_CI[stack.commands.ci];
}

/** The framework-specific build/verify command to append to the CI recipe, or null. */
export function frameworkBuildHint(stack: StackContext): string | null {
  return firstHit(stack.frameworks, BUILD_BY_FRAMEWORK);
}

// ── Per-dimension framework / role notes ──────────────────────────────────────────────────────────
// A framework's entry says what THIS dimension's control looks like for THIS stack. These are the
// lines that make two same-language, same-weak-dimension repos read differently. Deliberately
// concrete (a real command / a real file), never generic hygiene restated.

type DimNotes = Partial<Record<DimensionId, string>>;

const FRAMEWORK_NOTES: Record<string, DimNotes> = {
  "Next.js": {
    D1: "Document the App Router boundaries an agent must respect: server vs client components, which files may carry 'use server', and where env access is legal",
    D2: "Cover route handlers and server actions, not just leaf utils: that boundary is where agent-written Next.js code actually breaks",
    D3: "next build runs pre-push: a bad route export or a server/client boundary violation must not first surface on the deploy",
    D6: "eslint-config-next runs on staged files so the framework's own rules (not just generic ESLint) hold",
    D9: "No secret is read outside a server component / route handler: a NEXT_PUBLIC_ leak ships to every browser",
  },
  React: {
    D2: "Component tests assert behavior via @testing-library/react (queries by role/text), never implementation detail an agent will churn",
  },
  Angular: {
    D2: "ng test --watch=false --browsers=ChromeHeadless is the one local command; keep the spec next to its component",
    D6: "Angular's own strict template + strict-injection compiler flags are on, so the compiler holds the conventions",
  },
  NestJS: {
    D2: "Module-level e2e specs (supertest against the Nest testing module) cover the DI wiring an agent is most likely to break",
  },
  Express: {
    D2: "Route-level integration tests (supertest) cover the middleware order: an agent reordering middleware is a silent auth bug",
    D9: "helmet + input validation on every route are asserted by a test, not assumed",
  },
  Django: {
    D2: "pytest-django runs the migration + view suite locally, so an agent's model change surfaces before push",
    D3: "python manage.py makemigrations --check --dry-run runs pre-push: a model edit without a migration is a broken deploy",
    D9: "python manage.py check --deploy runs pre-push (DEBUG, SECRET_KEY, HSTS, cookie flags)",
  },
  FastAPI: {
    D2: "TestClient contract tests pin every response model: the OpenAPI schema is the agent's contract",
    D5: "The generated OpenAPI schema is committed/diffed so an agent's route change is visible in review",
  },
  Flask: {
    D2: "app.test_client() route tests cover the blueprint registration an agent is likely to disturb",
  },
  Rails: {
    D2: "bundle exec rspec plus a request-spec for every controller an agent may touch",
    D3: "bundle exec rails zeitwerk:check and a pending-migration check run pre-push",
  },
  Laravel: {
    D2: "php artisan test covers feature routes; factories keep the fixtures an agent needs legible",
  },
  Spring: {
    D2: "@SpringBootTest slices cover the bean wiring; keep them fast enough to run pre-push",
    D9: "OWASP dependency-check runs on the Maven/Gradle graph before a new dependency lands",
  },
  Android: {
    D3: "./gradlew assembleRelease + lint run before push; a release-only resource/proguard break must not reach the store track",
    D9: "No key/keystore or API secret is in the repo; they come from the CI secret store, asserted by the secret scan",
  },
  iOS: {
    D3: "xcodebuild test on the simulator runs pre-push; the scheme is shared and committed so an agent can run it",
    D9: "Entitlements + Info.plist changes are reviewed explicitly: an agent widening a capability is a privacy regression",
  },
  Flutter: {
    D2: "flutter test --coverage locally; widget tests cover the screens an agent edits",
    D6: "flutter analyze with the project's analysis_options.yaml runs on staged files",
  },
  "React Native": {
    D2: "Detox/e2e smoke on the critical flow, because a JS-only unit pass hides native-module breakage",
  },
  Terraform: {
    D1: "State/backend location, which workspaces exist, and which resources an agent must NEVER destroy are written down",
    D3: "terraform validate + terraform plan runs pre-push and the PLAN is what gets reviewed; apply stays a gated human step",
    D9: "tfsec/checkov run pre-commit; a public bucket or open security group is caught before the plan is even shared",
  },
  Helm: {
    D3: "helm lint + helm template are run pre-push so a broken chart never reaches the cluster",
  },
  Kubernetes: {
    D3: "kubectl apply --dry-run=server (or kubeconform) validates manifests pre-push against the real API schema",
    D9: "Pod security context, resource limits, and secret refs are asserted by policy (conftest/kyverno), not review",
  },
  Jupyter: {
    D2: "Notebooks are EXECUTED in the suite (nbval/papermill): a notebook that only lints is untested code",
    D6: "nbstripout runs pre-commit so outputs and execution counts don't pollute every diff",
    D7: "Notebook diffs are made reviewable (nbdime) so an agent's change is legible in the history",
  },
  PyTorch: {
    D8: "Model/prompt changes are gated on a fixed eval set with a seeded run: accuracy deltas are the test",
  },
  TensorFlow: {
    D8: "Model/prompt changes are gated on a fixed eval set with a seeded run: accuracy deltas are the test",
  },
};

/** Role-level notes — coarser than a framework, applied when no framework covered the dimension. */
const ROLE_NOTES: Partial<Record<StackRole, DimNotes>> = {
  data_ml: {
    D2: "Data/feature transforms have deterministic, seeded tests: a silent distribution change is the failure mode",
    D8: "A held-out eval set with recorded baselines is the gate for any model or prompt change",
  },
  infra: {
    D3: "The plan/diff is what gets reviewed and apply is a gated human step; never let an agent apply directly",
    D9: "Policy-as-code (tfsec/checkov/conftest) runs pre-commit; a misconfigured resource is caught before the plan",
  },
  mobile: {
    D3: "A release-configuration build runs before push: debug-only passes hide store-blocking breakage",
  },
  library: {
    D5: "The public API surface is documented and diffed; a breaking export change needs an explicit note",
    D7: "Releases are semver-tagged with a changelog entry so consumers (and agents) can reason about upgrades",
  },
};

/**
 * The stack-specific notes for one dimension: at most one line per matched framework (in detection
 * order), plus role-level lines only when no framework spoke to this dimension. Returns [] when the
 * stack is unknown — the caller then renders exactly today's static track.
 */
export function stackNotesFor(dimId: DimensionId, stack: StackContext): string[] {
  const notes: string[] = [];
  for (const f of stack.frameworks) {
    const line = FRAMEWORK_NOTES[f]?.[dimId];
    if (line) notes.push(`${f}: ${line}`);
  }
  if (notes.length === 0) {
    for (const r of stack.roles) {
      const line = ROLE_NOTES[r]?.[dimId];
      if (line) notes.push(`${r.replace("_", "/")} repo: ${line}`);
    }
  }
  return notes;
}

/** One-line description of the detected stack for the track header, or null when nothing was detected. */
export function stackLabel(stack: StackContext): string | null {
  const parts = [stack.language, ...stack.frameworks].filter(Boolean) as string[];
  return parts.length ? [...new Set(parts)].join(" · ") : null;
}
