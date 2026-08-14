import { describe, it, expect } from "vitest";
import { buildArtifact, commandsFor, type LangCommands } from "./practice-artifact";
import { PRACTICES } from "@/lib/practices";

const ctx = { fullName: "acme/api", name: "api", description: "Billing API", primaryLanguage: "TypeScript", defaultBranch: "main" };

// Lock the language→commands map: each supported language maps to its documented CI/practice
// commands, and an unknown/empty language degrades to the generic placeholder set (never empty,
// never a concrete-but-wrong toolchain). commandsFor is the single source of truth reused by the
// onboarding-skill generator + standard/manifest, so a dropped case or typo'd command ships a
// broken CI workflow / AGENTS.md into customer repos via PR. Pin the exact tuples.
describe("commandsFor — language→commands map", () => {
  const cases: Array<[label: string, input: string | null | undefined, expected: LangCommands]> = [
    [
      "typescript",
      "TypeScript",
      { install: "npm ci", test: "npm test", lint: "npm run lint", build: "npm run build", ci: "node" },
    ],
    [
      "javascript",
      "JavaScript",
      { install: "npm ci", test: "npm test", lint: "npm run lint", build: "npm run build", ci: "node" },
    ],
    [
      "python",
      "Python",
      { install: "pip install -e .[dev]", test: "pytest", lint: "ruff check .", build: "python -m build", ci: "python" },
    ],
    [
      "go",
      "Go",
      { install: "go mod download", test: "go test ./...", lint: "golangci-lint run", build: "go build ./...", ci: "go" },
    ],
    [
      "rust",
      "Rust",
      { install: "cargo fetch", test: "cargo test", lint: "cargo clippy -- -D warnings", build: "cargo build --release", ci: "rust" },
    ],
    // ── extended families: real commands, `ci: "generic"` (the exhaustive Record<ci,…> maps in
    // standard/manifest.ts + onboarding/tracks.ts must stay unaffected), explicit `ciSetup`.
    [
      "ruby",
      "Ruby",
      { install: "bundle install", test: "bundle exec rspec", lint: "bundle exec rubocop", build: "bundle exec rake build", ci: "generic", ciSetup: "ruby/setup-ruby" },
    ],
    [
      "php",
      "PHP",
      { install: "composer install", test: "vendor/bin/phpunit", lint: "vendor/bin/php-cs-fixer fix --dry-run", build: "composer dump-autoload -o", ci: "generic", ciSetup: "shivammathur/setup-php" },
    ],
    [
      "java",
      "Java",
      { install: "mvn -B dependency:go-offline", test: "mvn -B test", lint: "mvn -B checkstyle:check", build: "mvn -B package", ci: "generic", ciSetup: "actions/setup-java" },
    ],
    [
      "kotlin",
      "Kotlin",
      { install: "./gradlew dependencies", test: "./gradlew test", lint: "./gradlew ktlintCheck", build: "./gradlew build", ci: "generic", ciSetup: "actions/setup-java" },
    ],
    [
      "scala",
      "Scala",
      { install: "sbt update", test: "sbt test", lint: "sbt scalafmtCheckAll", build: "sbt package", ci: "generic", ciSetup: "actions/setup-java" },
    ],
    [
      "c#",
      "C#",
      { install: "dotnet restore", test: "dotnet test", lint: "dotnet format --verify-no-changes", build: "dotnet build -c Release", ci: "generic", ciSetup: "actions/setup-dotnet" },
    ],
    [
      "swift",
      "Swift",
      { install: "swift package resolve", test: "swift test", lint: "swiftlint", build: "swift build -c release", ci: "generic", ciSetup: "swift-actions/setup-swift" },
    ],
    [
      "dart",
      "Dart",
      { install: "dart pub get", test: "dart test", lint: "dart analyze", build: "dart compile exe", ci: "generic", ciSetup: "dart-lang/setup-dart" },
    ],
    [
      "elixir",
      "Elixir",
      { install: "mix deps.get", test: "mix test", lint: "mix credo --strict", build: "mix compile --warnings-as-errors", ci: "generic", ciSetup: "erlef/setup-beam" },
    ],
  ];

  const GENERIC: LangCommands = {
    install: "<install deps>",
    test: "<run tests>",
    lint: "<run linter>",
    build: "<build>",
    ci: "generic",
  };

  it.each(cases)("maps %s to its exact documented command tuple", (_label, input, expected) => {
    expect(commandsFor(input)).toEqual(expected);
  });

  it("is case-insensitive on the language name", () => {
    expect(commandsFor("PYTHON")).toEqual(commandsFor("python"));
    expect(commandsFor("typescript")).toEqual(commandsFor("TypeScript"));
    expect(commandsFor("RUBY")).toEqual(commandsFor("ruby"));
  });

  it("maps every alias onto its family's tuple (node family, C#)", () => {
    for (const alias of ["JavaScript", "Node", "Node.js"]) {
      expect(commandsFor(alias)).toEqual(commandsFor("TypeScript"));
    }
    expect(commandsFor("csharp")).toEqual(commandsFor("C#"));
  });

  it("every extended family carries a ciSetup action and keeps ci: 'generic'", () => {
    // The pair is the whole contract: `ci` stays inside the five-value union the exhaustive
    // Record<ci,…> maps key on, while ciSetup names the real Actions setup step for the workflow.
    for (const lang of ["Ruby", "PHP", "Java", "Kotlin", "Scala", "C#", "Swift", "Dart", "Elixir"]) {
      const c = commandsFor(lang);
      expect(c.ci, lang).toBe("generic");
      expect(c.ciSetup, lang).toMatch(/^[\w.-]+\/[\w.-]+$/);
    }
    // The original five derive their setup id from `ci` and must NEVER carry ciSetup.
    for (const lang of ["TypeScript", "Python", "Go", "Rust", "Cobol", null]) {
      expect(commandsFor(lang).ciSetup, String(lang)).toBeUndefined();
    }
  });

  it.each([
    ["unknown language", "Cobol"],
    ["empty string", ""],
    ["null", null],
    ["undefined", undefined],
  ])("falls back to the generic tuple for %s (never empty, never node)", (_label, input) => {
    expect(commandsFor(input)).toEqual(GENERIC);
  });

  it("the fallback ci id is 'generic', not a concrete toolchain", () => {
    expect(commandsFor(null).ci).toBe("generic");
    expect(commandsFor(undefined).ci).toBe("generic");
    expect(commandsFor("").ci).toBe("generic");
  });

  it("never returns empty/blank command strings for any branch", () => {
    for (const lang of ["TypeScript", "JavaScript", "Python", "Go", "Rust", "Cobol", "", null, undefined]) {
      const c = commandsFor(lang);
      for (const v of [c.install, c.test, c.lint, c.build]) {
        expect(typeof v).toBe("string");
        expect(v.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("stability guard: dropping any language's commands fails this test", () => {
    // Snapshot the FULL map (14 language families + the fallback = 15 tuples) so a regression that
    // drops/alters a case is caught here — the header claim that this file pins the single source of
    // truth only holds if every branch is present.
    const actual = Object.fromEntries(
      [...cases.map(([label, input]) => [label, commandsFor(input)] as const), ["fallback", commandsFor(null)] as const],
    );
    expect(Object.keys(actual)).toHaveLength(15);
    expect(actual).toEqual({
      typescript: { install: "npm ci", test: "npm test", lint: "npm run lint", build: "npm run build", ci: "node" },
      javascript: { install: "npm ci", test: "npm test", lint: "npm run lint", build: "npm run build", ci: "node" },
      python: { install: "pip install -e .[dev]", test: "pytest", lint: "ruff check .", build: "python -m build", ci: "python" },
      go: { install: "go mod download", test: "go test ./...", lint: "golangci-lint run", build: "go build ./...", ci: "go" },
      rust: { install: "cargo fetch", test: "cargo test", lint: "cargo clippy -- -D warnings", build: "cargo build --release", ci: "rust" },
      ruby: { install: "bundle install", test: "bundle exec rspec", lint: "bundle exec rubocop", build: "bundle exec rake build", ci: "generic", ciSetup: "ruby/setup-ruby" },
      php: { install: "composer install", test: "vendor/bin/phpunit", lint: "vendor/bin/php-cs-fixer fix --dry-run", build: "composer dump-autoload -o", ci: "generic", ciSetup: "shivammathur/setup-php" },
      java: { install: "mvn -B dependency:go-offline", test: "mvn -B test", lint: "mvn -B checkstyle:check", build: "mvn -B package", ci: "generic", ciSetup: "actions/setup-java" },
      kotlin: { install: "./gradlew dependencies", test: "./gradlew test", lint: "./gradlew ktlintCheck", build: "./gradlew build", ci: "generic", ciSetup: "actions/setup-java" },
      scala: { install: "sbt update", test: "sbt test", lint: "sbt scalafmtCheckAll", build: "sbt package", ci: "generic", ciSetup: "actions/setup-java" },
      "c#": { install: "dotnet restore", test: "dotnet test", lint: "dotnet format --verify-no-changes", build: "dotnet build -c Release", ci: "generic", ciSetup: "actions/setup-dotnet" },
      swift: { install: "swift package resolve", test: "swift test", lint: "swiftlint", build: "swift build -c release", ci: "generic", ciSetup: "swift-actions/setup-swift" },
      dart: { install: "dart pub get", test: "dart test", lint: "dart analyze", build: "dart compile exe", ci: "generic", ciSetup: "dart-lang/setup-dart" },
      elixir: { install: "mix deps.get", test: "mix test", lint: "mix credo --strict", build: "mix compile --warnings-as-errors", ci: "generic", ciSetup: "erlef/setup-beam" },
      fallback: GENERIC,
    });
  });
});

// A repo in an EXTENDED family used to get real commands under "# TODO: add the language setup step
// for this repo" — a workflow that lints/tests with a toolchain the runner never installed, i.e. a
// guaranteed-red PR. ciWorkflow now emits the family's `ciSetup` action.
describe("buildArtifact ci-gates — extended families emit a RUNNABLE setup step", () => {
  it("Ruby: full workflow has a pinned setup-ruby step and no TODO placeholder", () => {
    const a = buildArtifact("ci-gates", { ...ctx, primaryLanguage: "Ruby" })!;
    expect(a.path).toBe(".github/workflows/ci.yml");
    expect(a.body).toContain("      - uses: ruby/setup-ruby@v1\n        with:\n          ruby-version: '3.3'\n          bundler-cache: true\n");
    expect(a.body).not.toContain("# TODO: add the language setup step");
    expect(a.body).not.toContain("setup-node");
    // The step sits between checkout and the commands, in a single well-formed steps: sequence.
    expect(a.body.indexOf("actions/checkout")).toBeLessThan(a.body.indexOf("ruby/setup-ruby"));
    expect(a.body.indexOf("ruby/setup-ruby")).toBeLessThan(a.body.indexOf("- run: bundle install"));
    expect(a.body).toContain("- run: bundle exec rspec");
  });

  it("Java: setup-java carries the `distribution` input the action REQUIRES to run", () => {
    const a = buildArtifact("ci-gates", { ...ctx, primaryLanguage: "Java" })!;
    expect(a.body).toContain("- uses: actions/setup-java@v4");
    expect(a.body).toContain("distribution: temurin");
    expect(a.body).not.toContain("# TODO: add the language setup step");
    expect(a.body).toContain("- run: mvn -B test");
  });

  it.each(["Ruby", "PHP", "Java", "Kotlin", "Scala", "C#", "Swift", "Dart", "Elixir"])(
    "%s emits a version-pinned uses: step (never a floating ref) and never a TODO",
    (lang) => {
      const a = buildArtifact("ci-gates", { ...ctx, primaryLanguage: lang })!;
      const setup = commandsFor(lang).ciSetup!;
      expect(a.body).toMatch(new RegExp(`- uses: ${setup.replace(/[/.]/g, "\\$&")}@v\\d+`));
      expect(a.body).not.toContain("# TODO: add the language setup step");
      expect(a.body).not.toContain("<run tests>");
    },
  );
});

describe("buildArtifact ci-gates — unknown language never inherits a node toolchain", () => {
  it.each([
    ["python", "Python", "setup-python", "pytest"],
    ["go", "Go", "setup-go", "go test ./..."],
    ["rust", "Rust", "rust-toolchain", "cargo test"],
  ])("emits the %s setup step + commands", (_label, lang, setup, cmd) => {
    const a = buildArtifact("ci-gates", { ...ctx, primaryLanguage: lang })!;
    expect(a.body).toContain(setup);
    expect(a.body).toContain(cmd);
    expect(a.body).not.toContain("setup-node");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["unknown", "Cobol"],
  ])("uses the generic TODO setup (not setup-node) for %s language", (_label, lang) => {
    const a = buildArtifact("ci-gates", { ...ctx, primaryLanguage: lang as string | null })!;
    expect(a.body).toContain("# TODO: add the language setup step");
    expect(a.body).not.toContain("setup-node");
    expect(a.body).not.toContain("setup-python");
    expect(a.body).not.toContain("setup-go");
    expect(a.body).toContain("<install deps>");
  });
});

describe("buildArtifact", () => {
  it("builds a tailored AGENTS.md for agent-guidance with the repo's commands", () => {
    const a = buildArtifact("agent-guidance", ctx)!;
    expect(a.path).toBe("AGENTS.md");
    expect(a.body).toContain("npm test");
    expect(a.body).toContain("Billing API");
    expect(a.branch).toBe("ascent/agent-guidance");
    expect(a.prTitle).toContain("Agent guidance");
  });

  it("emits a language-appropriate CI workflow", () => {
    const node = buildArtifact("ci-gates", ctx)!;
    expect(node.path).toBe(".github/workflows/ci.yml");
    expect(node.body).toContain("setup-node");
    const go = buildArtifact("ci-gates", { ...ctx, primaryLanguage: "Go" })!;
    expect(go.body).toContain("setup-go");
    expect(go.body).toContain("go test ./...");
  });

  it("produces a real artifact for every catalogued practice", () => {
    for (const p of PRACTICES) {
      const a = buildArtifact(p.id, ctx);
      expect(a, `practice ${p.id} should yield an artifact`).not.toBeNull();
      expect(a!.path.length).toBeGreaterThan(0);
      expect(a!.body.length).toBeGreaterThan(40);
    }
  });

  it("returns null for an unknown practice", () => {
    expect(buildArtifact("nope", ctx)).toBeNull();
  });

  it("degrades to placeholders when repo context is sparse", () => {
    const a = buildArtifact("agent-guidance", { fullName: "x/y", name: "y" })!;
    expect(a.body).toContain("<install deps>");
    expect(a.body).toContain("TODO");
  });
});

// practices #7 — repo-supplied metadata (description / name / branch) is committed VERBATIM into a file
// in the customer's repo. A hostile value must be neutralized so it can't break out of the surrounding
// markdown/YAML structure or inject content.
describe("buildArtifact — repo-metadata is escaped before it lands in the committed file", () => {
  it("strips code-span/HTML breakers and collapses newlines from a hostile description", () => {
    const hostile = "Legit desc `code`\n## Injected heading <img src=x onerror=alert(1)>";
    const a = buildArtifact("agent-guidance", { fullName: "acme/api", name: "api", description: hostile })!;
    // Backticks and angle brackets are removed; the newline is collapsed so the injected `##` can never
    // begin a heading line (it survives only as inline literal text, not markdown structure).
    expect(a.body).not.toContain("`code`");
    expect(a.body).not.toContain("<img");
    expect(a.body).not.toContain("\n## Injected heading");
    // The benign words survive (sanitized, not dropped wholesale).
    expect(a.body).toContain("Legit desc");
  });

  it("neutralizes backticks in the repo name embedded in a heading", () => {
    const a = buildArtifact("test-discipline", { fullName: "acme/`evil`", name: "`evil`", description: "d" })!;
    expect(a.body).not.toContain("`evil`");
    expect(a.body).toContain("evil");
  });

  it("YAML-quotes the default branch in the CI workflow so it can't inject sequence items", () => {
    const a = buildArtifact("ci-gates", { fullName: "acme/api", name: "api", primaryLanguage: "Go", defaultBranch: "main" })!;
    // The branch is emitted as a quoted YAML scalar (JSON.stringify), not a bare token.
    expect(a.body).toContain('branches: ["main"]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// W6 — the artifact carries the org's OWN mined pattern when one exists, and the PR body SAYS which
// shape it shipped. "Your own pattern, from 3 repositories" and "a generic starter" are very
// different claims to put in front of an engineer, and a PR that blurred them would spend exactly
// the credibility the mining exists to earn.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("house pattern + provenance", () => {
  const ctx = { fullName: "acme/web", name: "web", primaryLanguage: "TypeScript" };
  const house = { lines: ["Commands", "Architecture map"], exemplars: ["acme/api", "acme/core"] };

  it("appends the org's shared pattern as its own attributed section", () => {
    const a = buildArtifact("agent-guidance", { ...ctx, house })!;
    expect(a.body).toContain("## Your organization's shared pattern");
    expect(a.body).toContain("acme/api, acme/core");
    expect(a.body).toContain("- Commands");
    // The reader must be able to tell that only structure was read.
    expect(a.body).toMatch(/only the heading structure/i);
  });

  it("states the provenance as the org's own when a pattern shipped", () => {
    const a = buildArtifact("agent-guidance", { ...ctx, house })!;
    expect(a.prBody).toMatch(/your organization's own/i);
    expect(a.prBody).toContain("2 repositories");
    expect(a.prBody).toMatch(/no file contents travelled/i);
  });

  // The honest half. A generic starter must SAY it is generic, and say what would change that.
  it("states the provenance as generic when no pattern was mined", () => {
    const a = buildArtifact("agent-guidance", ctx)!;
    expect(a.prBody).toMatch(/a generic starter/i);
    expect(a.prBody).toMatch(/at least two of them/i);
    expect(a.body).not.toContain("## Your organization's shared pattern");
  });

  it("treats an empty mined pattern as no pattern rather than an empty section", () => {
    const a = buildArtifact("agent-guidance", { ...ctx, house: { lines: [], exemplars: ["acme/api"] } })!;
    expect(a.body).not.toContain("## Your organization's shared pattern");
    expect(a.prBody).toMatch(/a generic starter/i);
  });

  // Mined lines come from the org's own files, which are still untrusted text landing in a committed
  // artifact — the same escaping every other repo-supplied field goes through.
  it("escapes mined lines before they reach the committed file", () => {
    const nasty = { lines: ["<script>alert(1)</script>"], exemplars: ["acme/api", "acme/core"] };
    const a = buildArtifact("agent-guidance", { ...ctx, house: nasty })!;
    expect(a.body).not.toContain("<script>");
  });
});
