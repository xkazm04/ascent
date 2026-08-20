// The NO-VENDOR-BRANCHING guard for the passport's scoring module (APP_READINESS_PASSPORT.md §5.6).
//
// The rule held before 0.4.0 only because one module happened to behave: nothing stated it and nothing
// enforced it, so the next contributor wanting a rung criterion keyed to a specific tool had nothing to
// be refused by. Once one score pays out for a named vendor, a repo scores differently for choosing a
// different tool that does the same job and the passport stops being portable across stacks — which is
// the entire premise of the artifact.
//
// The guard is scoped to the SCORING module on purpose. A repo-wide grep would false-positive on the
// detection layer in passport.ts, which legitimately must know vendor names: naming a tool is the
// passport's job, scoring on the name is not.

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { SCORED_RUNGS, deriveProductionScore } from "@/lib/analyze/passport-score";

const SOURCE = fs.readFileSync(path.resolve(__dirname, "passport-score.ts"), "utf8");

/** Only the executable half — the header comment must be free to NAME the vendors it forbids. */
const CODE = SOURCE.split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join("\n");

// A representative slice of every vendor family the detection layer knows: observability, hosting,
// CI providers, ORMs, LLM APIs. Not exhaustive by design — this is a tripwire, not a proof.
const VENDORS = [
  "sentry", "rollbar", "bugsnag", "datadog", "prometheus", "otel", "opentelemetry", "pino", "winston",
  "vercel", "netlify", "fly", "github-actions", "dependabot", "codeql", "gitleaks", "trivy", "cosign",
  "prisma", "drizzle", "mongoose", "redis", "supabase", "clerk", "stripe", "polar", "openai", "anthropic",
  "vitest", "jest", "playwright", "cypress", "pytest",
];

describe("passport-score — no consumer branches on a vendor name", () => {
  it("contains no vendor-name literal in its executable code", () => {
    const found = VENDORS.filter((v) => new RegExp(`["'\`]${v}`, "i").test(CODE));
    expect(found).toEqual([]);
  });

  it("scores exclusively on the passport's ordinal rungs — every scored key is an enum member", () => {
    // If a table ever grew a vendor key, it would show up here as a rung nobody declared.
    expect(SCORED_RUNGS.ci).toEqual(["none", "build", "checks", "gated", "delivery", "progressive"]);
    expect(SCORED_RUNGS.tests).toEqual(["none", "smoke", "partial", "substantial", "comprehensive"]);
    expect(SCORED_RUNGS.security).toEqual(["none", "policy", "scanning", "gated", "supply-chain"]);
    expect(SCORED_RUNGS.observability).toEqual(["none", "logs", "errors", "metrics", "tracing"]);
  });

  it("is blind to the provider/tool names the sub-scales carry alongside their rungs", () => {
    const base = {
      ci: { level: "gated", provider: "github-actions", gates: ["test"] },
      tests: { level: "partial", coveragePct: null, frameworks: ["vitest"], criticalPathCovered: false },
      security: { level: "scanning", tools: ["dependabot", "codeql"] },
      observability: { level: "errors" },
      delivery: { migrations: "versioned" as const, iac: false, rollback: false },
    };
    const swapped = {
      ...base,
      ci: { level: "gated", provider: "gitlab-ci", gates: ["test"] },
      tests: { ...base.tests, frameworks: ["pytest"] },
      security: { level: "scanning", tools: ["snyk"] },
    };
    // Same rungs, different vendors: identical score. That equality IS the portability promise.
    expect(deriveProductionScore(swapped)).toEqual(deriveProductionScore(base));
  });
});
