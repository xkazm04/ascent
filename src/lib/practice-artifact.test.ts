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
    // Snapshot the full map so a regression that drops/alters a case is caught here.
    expect({
      typescript: commandsFor("TypeScript"),
      javascript: commandsFor("JavaScript"),
      python: commandsFor("Python"),
      go: commandsFor("Go"),
      rust: commandsFor("Rust"),
      fallback: commandsFor(null),
    }).toEqual({
      typescript: { install: "npm ci", test: "npm test", lint: "npm run lint", build: "npm run build", ci: "node" },
      javascript: { install: "npm ci", test: "npm test", lint: "npm run lint", build: "npm run build", ci: "node" },
      python: { install: "pip install -e .[dev]", test: "pytest", lint: "ruff check .", build: "python -m build", ci: "python" },
      go: { install: "go mod download", test: "go test ./...", lint: "golangci-lint run", build: "go build ./...", ci: "go" },
      rust: { install: "cargo fetch", test: "cargo test", lint: "cargo clippy -- -D warnings", build: "cargo build --release", ci: "rust" },
      fallback: GENERIC,
    });
  });
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
