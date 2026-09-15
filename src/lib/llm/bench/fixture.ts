// The benchmark's scanned repository, shared by the runner and the diagnostic so both send
// byte-identical input. A benchmark whose two halves disagree about the prompt measures nothing.

import type { LlmScoreInput } from "@/lib/llm/provider";

/**
 * Real signals for xkazm04/lighttrack, read off the checkout on 2026-09-05.
 *
 * Scores are the deterministic analyzers' own numbers as this harness estimates them from the
 * observable artifacts; the model's job is to CALIBRATE them, so they are deliberately plausible
 * rather than authoritative — that is exactly the input the real pipeline hands over.
 */
export const input: LlmScoreInput = {
  repo: {
    owner: "xkazm04",
    name: "lighttrack",
    url: "https://github.com/xkazm04/lighttrack",
    stars: 0,
    forks: 0,
    defaultBranch: "main",
  },
  archetype: "solo",
  commitSample: [
    "fix: Added judge eval corpus with recorded verdicts",
    "chore: add ai process & harness starter (via Ascent)",
    "ai: record the 2026-09-04 inventory-legibility apply row",
    "agent: name why the action library is empty, without changing what it advertises",
    "feat(store): dataset lineage - four sampling strategies, fork, and version walk",
  ],
  files: [
    {
      path: "CLAUDE.md",
      content:
        "# CLAUDE.md - working agreement for LightTrack\n\n" +
        "## Code structure & composability (enforce in every change)\n" +
        "- <= ~300 LOC per file. If a file grows past it, split by responsibility.\n" +
        "- Binaries' main.rs is wiring only: parse args / build router / dispatch. No business logic.\n" +
        "- One module per domain or concern.\n" +
        "## Secrets & safety\n" +
        "- .env and service-account*.json are git-ignored. Never commit API keys.\n" +
        "- The remote (github.com/xkazm04/lighttrack) is PUBLIC.\n" +
        "## Key invariants (don't regress)\n" +
        "- The judge/scoring engine is unbudgeted; limits apply only to monitored ingest traffic.\n" +
        "- Prices are DB-backed (model_prices, seeded from config/pricing.json).\n" +
        "- Backend parity is a correctness property, not a nicety.\n",
      bytes: 0, // not rendered into the prompt (used only for fetch budgeting upstream)
    },
    {
      path: ".ai/manifest.yaml",
      content:
        "schema: ai-manifest\nschemaVersion: 0.1.0\n" +
        "repo:\n  name: tracklight\n  archetype: service\n  languages: [rust, typescript, python]\n" +
        "capabilities:\n" +
        "  build: { command: 'cargo build --workspace', verified: false }\n" +
        "  test: { command: 'cargo test --workspace', verified: false }\n" +
        "  lint: { command: 'cargo clippy --workspace --all-targets -- -D warnings', verified: false }\n" +
        "  audit-policy: { command: 'cargo deny --locked check bans licenses sources', verified: true }\n" +
        "  audit-secrets: { command: 'gitleaks git . --config .gitleaks.toml --redact', verified: true }\n" +
        "  chart-policy: { command: 'cargo test -p lighttrack-core --test chart_policy_guard', verified: true }\n" +
        "controls:\n" +
        "  ciHardPass: [test, conformance, chart-policy, lint, format-check, audit-policy, audit-secrets]\n" +
        "  ciAdvisory: [audit-advisories, audit-secrets-latest-rules]\n",
      bytes: 0, // not rendered into the prompt (used only for fetch budgeting upstream)
    },
    {
      path: "docs/PARITY.md",
      content:
        "# Backend parity\n\nWhat each Store backend implements, declared by the backend itself.\n" +
        "full = the conformance suite runs the surface's complete semantics against it.\n" +
        "refused = every method answers StoreError::Unsupported, which the API renders as HTTP 501 -\n" +
        "and the conformance suite asserts that refusal, so a gap can never quietly become an empty page.\n" +
        "| Surface | sqlite | postgres | firestore |\n|---|---|---|---|\n" +
        "| events_core | full | full | full |\n| traces | full | full | refused |\n" +
        "| use_cases | full | refused | refused |\n",
      bytes: 0, // not rendered into the prompt (used only for fetch budgeting upstream)
    },
  ],
  signals: [
    {
      id: "D1",
      signalScore: 85,
      signals: [
        { label: "CLAUDE.md present, 100+ lines, with enforceable rules (<=300 LOC/file, main.rs is wiring only)" },
        { label: ".ai/manifest.yaml declares tool-neutral capabilities with a `verified` flag per command" },
        { label: "context-map.json present" },
        { label: "AGENTS.md absent" },
      ],
    },
    {
      id: "D2",
      signalScore: 80,
      signals: [
        { label: "cargo test --workspace across 15 crates; ~1400 tests observed" },
        { label: "dedicated conformance suite (sqlite_conformance) run per store backend" },
        { label: "schema equivalence test pins a frozen pre-migration schema" },
        { label: "no coverage threshold enforced in CI" },
      ],
    },
    {
      id: "D3",
      signalScore: 75,
      signals: [
        { label: ".github/workflows/ci.yml with a declared hard-pass set of 10 jobs" },
        { label: "advisory jobs (RUSTSEC feed, latest gitleaks rules) deliberately non-blocking" },
        { label: "release.yml hand-rolled matrix build + installer; cargo-dist configured but not adopted" },
      ],
    },
    {
      id: "D4",
      signalScore: 70,
      signals: [
        { label: ".claude/skills/ present with 6 project skills" },
        { label: "an agent relay crate (crates/agent) with a cloud task queue" },
        { label: "MCP server crate (crates/mcp) exposing read tools, write tools env-gated off by default" },
      ],
    },
    {
      id: "D5",
      signalScore: 88,
      signals: [
        { label: "docs/ carries ARCHITECTURE, DECISIONS, ROADMAP, PARITY, DATA_MODEL, BENCHMARK_FRAMEWORK" },
        { label: "generated docs are test-enforced (schema_doc, parity_doc regenerate or fail)" },
        { label: "README documents a two-command first run" },
      ],
    },
    {
      id: "D6",
      signalScore: 82,
      signals: [
        { label: "clippy -D warnings in CI" },
        { label: "cargo fmt --check in CI" },
        { label: "cargo deny for bans/licenses/sources, verified" },
        { label: "a declarative schema model renders DDL for 3 dialects from one source" },
      ],
    },
    {
      id: "D7",
      signalScore: 55,
      signals: [
        { label: "single-author history; ~250 commits" },
        { label: "no PR review data (work lands directly on main)" },
        { label: "conventional-ish commit subjects" },
      ],
    },
    {
      id: "D8",
      signalScore: 78,
      signals: [
        { label: ".ai/ directory carries directions ledger and applied rows" },
        { label: "an AI registry is declared as a consumed dependency with named knowledge domains" },
        { label: "a catch-up marker test asserts every doc under a family's surface is covered or skipped" },
      ],
    },
    {
      id: "D9",
      signalScore: 80,
      signals: [
        { label: "gitleaks full-history scan, pinned engine, blocking in CI" },
        { label: "cargo deny advisories on a weekly cron, advisory only" },
        { label: "MCP write tools default-off; secret-minting deliberately not exposed over MCP" },
        { label: "no SECURITY.md policy contact verified" },
      ],
    },
  ],
};
