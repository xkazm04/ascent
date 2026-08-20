// App Readiness Passport builder (see APP_READINESS_PASSPORT.md + app-passport.schema.json). A PURE,
// deterministic projection of a finished scan: it re-shapes the report + snapshot into the descriptive,
// tool-NAMING passport (the human/portfolio scorecard, sibling to the agent-facing .ai/manifest). Like
// extractTechStack it is DISPLAY/PERSIST-ONLY — never fed to the prompt or the score, so scans stay
// byte-identical. Determinism is load-bearing: snapshot+report only, no Date.now/IO/random.
//
// PRESENT vs ENFORCED is the design's core distinction and the token boundary: the "gated" rungs of CI
// and Security require branch protection (report.governance), which is null on a tokenless scan. When
// governance is absent we HONESTLY CAP ci/security at the present rung and say so in evidence/blockers —
// never claim an enforcement we couldn't observe. See docs/archive/2026-concepts/2026-06-22-app-passport-scan-integration.md.
//
// This file is the BUILDER + the barrel. The themed pieces live beside it and are re-exported here so no
// caller's import path changes: passport-grades.ts (the 0.2.0 memory/skills ladders), passport-score.ts
// (the derived production score), passport-overlay.ts (owner overrides + declined-by-choice), and
// passport-migrate.ts (PASSPORT_VERSION + the stored-passport upgrade applied in parsePassportJson).
//
// 0.4.0 adds three things this file owns, all of them about NOT CONFLATING two facts:
//   - UNKNOWN_CAPABILITY on the named fields: `null` used to mean both "the app has no error tracking"
//     and "the scan could not tell", so a fleet query reported a scan-coverage hole as a real gap.
//   - `findings[]`: every blocker gets a MINTED id (its cause code). Declines and fleet rollup buckets
//     join on that id; the sentence is payload. Rewording a blocker no longer orphans a decision.
//   - `evidence.fields`: per-field detection strength, so a vendor read out of a dependency list stops
//     looking as authoritative as one read off a fetched command.

import type {
  AppPassport,
  AutomationLevel,
  EvidenceBasis,
  FieldEvidence,
  Governance,
  PassportFinding,
  PrStats,
  RepoSnapshot,
  ScanReport,
  TechStack,
} from "@/lib/types";
import { AI_TOOL_ALT } from "./ai-tools";
import { gradeMemory, gradeSkills } from "./passport-grades";
import { deriveProductionScore } from "./passport-score";
import { deriveAutonomyTier } from "./passport-autonomy";
import { PASSPORT_VERSION, upgradePassport } from "./passport-migrate";

export type { AppPassport, ArtifactGrade, AutomationLevel, DeclinedByChoice, FieldEvidence, FindingSeverity, PassportFinding, ProductionBand } from "@/lib/types";
// Barrel: the themed sub-modules stay the implementation, this file stays the one import path callers use.
export { GRADE_RANK, gradeMemory, gradeSkills } from "./passport-grades";
export { deriveProductionScore } from "./passport-score";
export { TOKENLESS_MISSING, deriveAutonomyForStored, deriveAutonomyTier } from "./passport-autonomy";
export { PASSPORT_VERSION, upgradePassport } from "./passport-migrate";
export {
  DECLINABLE_PATHS,
  DECLINE_MAX_AGE_DAYS,
  applyPassportOverrides,
  isDeclinablePath,
  parseDeclined,
  parsePassportOverrides,
  type DeclineEntry,
  type PassportOverrides,
} from "./passport-overlay";

type Snap = Pick<RepoSnapshot, "meta" | "tree" | "files" | "commits" | "coverage">;

// ── snapshot probes (all pure) ─────────────────────────────────────────────────────────────────────
function probes(snap: Snap) {
  const fileByPath = new Map(snap.files.map((f) => [f.path.toLowerCase(), f.content]));
  const lowerPaths = snap.tree.map((t) => t.path.toLowerCase());
  const get = (p: string) => fileByPath.get(p) ?? fileByPath.get(p.replace(/^\.\//, ""));
  const hasPath = (pred: (p: string) => boolean) => lowerPaths.some(pred);
  const pkg = (() => {
    try {
      return JSON.parse(get("package.json") ?? "null") as Record<string, unknown> | null;
    } catch {
      return null;
    }
  })();
  const deps: string[] = [];
  if (pkg) {
    for (const f of ["dependencies", "devDependencies", "peerDependencies"]) {
      const o = pkg[f];
      if (o && typeof o === "object") deps.push(...Object.keys(o as Record<string, unknown>));
    }
  }
  const hasDep = (n: string) => deps.includes(n);
  const hasDepPrefix = (p: string) => deps.some((d) => d === p || d.startsWith(p));
  const workflowText = snap.files
    .filter((f) => /^\.github\/workflows\/.+\.ya?ml$/i.test(f.path))
    .map((f) => f.content)
    .join("\n")
    .toLowerCase();
  const scripts = (pkg?.scripts && typeof pkg.scripts === "object" ? (pkg.scripts as Record<string, string>) : {}) ?? {};
  // The two evidence sources a named field can be classified FROM. When one is missing the detectors
  // below must say `unknown`, not `null` — see UNKNOWN_CAPABILITY.
  const depsObservable = pkg !== null;
  const treeObservable = lowerPaths.length > 0;
  return { get, hasPath, lowerPaths, pkg, deps, hasDep, hasDepPrefix, workflowText, scripts, depsObservable, treeObservable };
}

/** The third value of every NAMED capability field (0.4.0). `null` means "the scan looked and this app
 *  has none"; UNKNOWN_CAPABILITY means "the scan could not look" — package.json or the tree index was
 *  outside the snapshot. Before 0.4.0 both collapsed to `null`, so a portfolio query answered "43 repos
 *  have no error tracking" when the truthful answer was "38 have none and 5 were never inspected", and
 *  a coverage problem in OUR scan was reported as a real gap in the customer's stack. It is an in-band
 *  string rather than an omitted key on purpose: the distinction has to survive the query, and an
 *  omitted key does not. Trade-off accepted: a vendor literally named "unknown" would be ambiguous. */
export const UNKNOWN_CAPABILITY = "unknown";

/** True for a named field that carries an actual vendor — i.e. not absent AND not unclassifiable.
 *  Every consumer that derives a rung from a named field must go through this, or an `unknown` reads
 *  as a truthy vendor name and fabricates a level nothing observed. */
export const isNamed = (v: string | null | undefined): v is string => typeof v === "string" && v !== UNKNOWN_CAPABILITY && v.length > 0;

/** The four fixed evidence rungs (0.4.0, item `passport-confidence-coarse`). Fixed VALUES, not a
 *  judgement per call site: a scale whose meaning is not stated becomes decorative, and consumers
 *  threshold on it inconsistently. See EvidenceBasis in src/lib/types.ts for what each rung claims. */
export const FIELD_EVIDENCE: Record<EvidenceBasis, FieldEvidence> = {
  observed: { confidence: 1, basis: "observed" },
  declared: { confidence: 0.8, basis: "declared" },
  inferred: { confidence: 0.5, basis: "inferred" },
  unobserved: { confidence: 0, basis: "unobserved" },
};

/** Per-field detection strength for the fields whose value is a GUESS of some kind. Deliberately not
 *  exhaustive: rating every field roughly doubles the artifact, which is the stated cost of per-field
 *  confidence, so only the named/heuristic fields are rated and a reader falls back to the
 *  whole-artifact `evidence.confidence` for the rest. Keys are the dotted paths DECLINABLE_PATHS uses,
 *  so the two vocabularies stay one vocabulary. */
function fieldEvidence(p: ReturnType<typeof probes>): Record<string, FieldEvidence> {
  // A dependency declaration NAMES a vendor; it never shows it running — that is the `declared` rung.
  const fromDeps = p.depsObservable ? FIELD_EVIDENCE.declared : FIELD_EVIDENCE.unobserved;
  // Path-shape heuristics over the tree index are weaker still.
  const fromTree = p.treeObservable ? FIELD_EVIDENCE.inferred : FIELD_EVIDENCE.unobserved;
  // CI is the one place we read fetched CONTENT (the workflow bodies), which is the `observed` rung;
  // a workflow file present in the tree but not fetched only supports `inferred`.
  const ci = p.workflowText.length > 0
    ? FIELD_EVIDENCE.observed
    : p.hasPath((x) => /^\.github\/workflows\/.+\.ya?ml$/.test(x))
      ? FIELD_EVIDENCE.inferred
      : fromTree;
  return {
    "stack.monitoring.errorTracking": fromDeps,
    "stack.monitoring.logs": fromDeps,
    "stack.monitoring.metrics": fromDeps,
    "stack.monitoring.tracing": fromDeps,
    "stack.monitoring.uptime": fromTree,
    "stack.hosting": fromTree,
    "productionReadiness.ci": ci,
  };
}

function detectStackBlock(snap: Snap, techStack: TechStack | undefined, p: ReturnType<typeof probes>): AppPassport["stack"] {
  const languages = (techStack?.languages ?? (snap.meta.primaryLanguage ? [snap.meta.primaryLanguage] : [])).map(
    (name, i) => ({ name, primary: i === 0 }),
  );

  const persistence: AppPassport["stack"]["persistence"] = [];
  if (p.hasDep("prisma") || p.hasDep("@prisma/client")) {
    const schema = p.get("prisma/schema.prisma") ?? "";
    const provider = /provider\s*=\s*"(\w+)"/.exec(schema)?.[1] ?? null;
    const documentEngines = new Set(["mongodb"]);
    persistence.push({
      kind: provider && documentEngines.has(provider) ? "document" : "relational",
      ...(provider ? { engine: provider } : {}),
      orm: "prisma",
      migrations: p.hasPath((x) => x.startsWith("prisma/migrations/")) ? "versioned" : "scripted",
      required: true,
    });
  } else if (p.hasDep("drizzle-orm")) {
    persistence.push({ kind: "relational", orm: "drizzle", migrations: p.hasPath((x) => x.includes("drizzle")) ? "versioned" : "scripted", required: true });
  } else if (p.hasDep("mongoose")) {
    persistence.push({ kind: "document", engine: "mongodb", orm: "mongoose", required: true });
  }
  if (p.hasDep("redis") || p.hasDep("ioredis")) persistence.push({ kind: "cache", engine: "redis", orm: null, required: false });

  // 0.4.0: every named field is three-valued. These four are read off the DEPENDENCY list, so with no
  // readable package.json we have not looked — `unknown`, never a `null` that reads as "app has none".
  const U = p.depsObservable ? null : UNKNOWN_CAPABILITY;
  const errorTracking = U ?? (p.hasDepPrefix("@sentry/") ? "sentry" : p.hasDep("rollbar") ? "rollbar" : p.hasDep("@bugsnag/js") ? "bugsnag" : null);
  const logs = U ?? (p.hasDep("pino") ? "pino" : p.hasDep("winston") ? "winston" : null);
  const metrics = U ?? (p.hasDep("prom-client") ? "prometheus" : p.hasDep("dd-trace") || p.hasDepPrefix("@datadog/") ? "datadog" : null);
  const tracing = U ?? (p.hasDepPrefix("@opentelemetry/") ? "otel" : null);
  // uptime + hosting are read off the TREE INDEX instead, so they turn unknown on an empty tree.
  const T = p.treeObservable ? null : UNKNOWN_CAPABILITY;
  const uptime = T ?? (p.hasPath((x) => /(^|\/)api\/health(\/|\.|$)/.test(x)) ? "/api/health" : null);

  const hosting = T ?? (p.get("vercel.json") !== undefined || p.hasPath((x) => x === ".vercel" || x.startsWith(".vercel/"))
    ? "vercel"
    : p.hasPath((x) => x.endsWith("fly.toml"))
      ? "fly"
      : p.hasPath((x) => x.endsWith("netlify.toml"))
        ? "netlify"
        : p.hasPath((x) => x === "dockerfile" || x.endsWith("/dockerfile"))
          ? "container"
          : null);

  // dep → integration vendor map. `kind` is the comparable axis; `name` is the vendor read after.
  const INTEG: { match: (has: typeof p.hasDep, pre: typeof p.hasDepPrefix) => boolean; name: string; kind: string; direction: string }[] = [
    { match: (_h, pre) => pre("@octokit/") || _h("octokit"), name: "GitHub", kind: "vcs", direction: "bidirectional" },
    { match: (h) => h("openai"), name: "OpenAI", kind: "llm", direction: "outbound" },
    { match: (_h, pre) => pre("@anthropic-ai/"), name: "Anthropic", kind: "llm", direction: "outbound" },
    { match: (_h, pre) => pre("@google/generative-ai") || pre("@google-cloud/vertexai") || _h("@google/genai"), name: "Google Gemini", kind: "llm", direction: "outbound" },
    { match: (h) => h("@aws-sdk/client-bedrock-runtime"), name: "AWS Bedrock", kind: "llm", direction: "outbound" },
    { match: (h) => h("stripe"), name: "Stripe", kind: "payments", direction: "bidirectional" },
    { match: (_h, pre) => pre("@polar-sh/"), name: "Polar", kind: "payments", direction: "bidirectional" },
    { match: (_h, pre) => pre("@supabase/"), name: "Supabase", kind: "auth", direction: "outbound" },
    { match: (h) => h("next-auth"), name: "NextAuth", kind: "auth", direction: "outbound" },
    { match: (_h, pre) => pre("@clerk/"), name: "Clerk", kind: "auth", direction: "outbound" },
    { match: (h) => h("resend"), name: "Resend", kind: "email", direction: "outbound" },
    { match: (_h, pre) => pre("@sendgrid/"), name: "SendGrid", kind: "email", direction: "outbound" },
    { match: (h) => h("nodemailer"), name: "SMTP/Nodemailer", kind: "email", direction: "outbound" },
    { match: (h) => h("@aws-sdk/client-s3"), name: "AWS S3", kind: "storage", direction: "outbound" },
  ];
  const integrations = INTEG.filter((i) => i.match(p.hasDep, p.hasDepPrefix)).map((i) => ({ name: i.name, kind: i.kind, direction: i.direction }));

  const packageManager = p.hasPath((x) => x === "pnpm-lock.yaml")
    ? "pnpm"
    : p.hasPath((x) => x === "yarn.lock")
      ? "yarn"
      : p.hasPath((x) => x === "bun.lockb")
        ? "bun"
        : p.pkg
          ? "npm"
          : undefined;

  const nodeEngine = (() => {
    const e = p.pkg?.engines as Record<string, string> | undefined;
    return e?.node ? `node${e.node.replace(/\s/g, "")}` : undefined;
  })();

  return {
    languages,
    ...(nodeEngine ? { runtime: nodeEngine } : {}),
    frameworks: techStack?.frameworks ?? [],
    ...(packageManager ? { packageManager } : {}),
    persistence,
    monitoring: { errorTracking, logs, metrics, tracing, uptime },
    hosting,
    integrations,
    secretsFrom: p.hasDepPrefix("@aws-sdk/") ? "env vars (.env) + AWS IAM" : "env vars (.env)",
  };
}

function detectArtifacts(p: ReturnType<typeof probes>): AppPassport["automationReadiness"]["artifacts"] {
  const candidates: [string, string][] = [
    ["claude.md", "CLAUDE.md"],
    ["agents.md", "AGENTS.md"],
    [".claude/claude.md", ".claude/CLAUDE.md"],
    [".cursorrules", ".cursorrules"],
    [".windsurfrules", ".windsurfrules"],
    [".clinerules", ".clinerules"],
    [".github/copilot-instructions.md", "copilot-instructions.md"],
  ];
  const agentInstructions = candidates.filter(([path]) => p.hasPath((x) => x === path)).map(([, label]) => label);
  const contextGraph = p.hasPath((x) => x === "context-map.json" || x === "context_map.json")
    ? "full"
    : p.hasPath((x) => x.endsWith("context.md"))
      ? "partial"
      : "none";
  // 0.2.0: memory/skills are graded ladders (none→adhoc→curated→governed), not booleans — see
  // passport-grades.ts for the rung criteria and the "score the lower rung when in doubt" rule.
  const memory = gradeMemory(p);
  const manifest = p.hasPath((x) => x === ".ai/manifest.yaml" || x === ".ai/manifest.yml");
  const evals = p.hasPath((x) => /(^|\/)(eval|evals|golden)(\/|s?\.)/.test(x) || x.includes(".golden.")) ? "partial" : "none";
  const skills = gradeSkills(p);
  // 0.3.0: structured autonomy-tier inputs (previously only a D1 evidence string for devcontainer).
  const sandbox = detectSandbox(p);
  const hooks = detectHooks(p);
  return { agentInstructions, contextGraph, memory, manifest, evals, skills, sandbox, hooks };
}

/** 0.3.0: a committed, reproducible environment definition — "can an agent get a disposable env
 *  that matches CI's". Tree-index only (presence is the claim; no content needed). */
function detectSandbox(p: ReturnType<typeof probes>): boolean {
  return p.hasPath(
    (x) =>
      x.startsWith(".devcontainer/") ||
      x === ".devcontainer.json" ||
      x.endsWith("/devcontainer.json") ||
      x === "dockerfile" ||
      x.endsWith("/dockerfile") ||
      x === "docker-compose.yml" ||
      x === "docker-compose.yaml" ||
      x === "compose.yml" ||
      x === "compose.yaml" ||
      x === "flake.nix" ||
      x === "shell.nix" ||
      x === "default.nix" ||
      x === ".tool-versions",
  );
}

/** 0.3.0: guardrail hooks that run without a reviewer present. Config-file presence in the tree,
 *  plus a `hooks` block in .claude/settings.json — the latter only when the CONTENT was fetched
 *  (a settings.json that merely exists proves nothing about hooks; don't claim it). */
function detectHooks(p: ReturnType<typeof probes>): boolean {
  if (
    p.hasPath(
      (x) =>
        x.startsWith(".husky/") ||
        x === "lefthook.yml" ||
        x === "lefthook.yaml" ||
        x === ".lefthook.yml" ||
        x === ".lefthook.yaml" ||
        x === "lefthook.toml" ||
        x === ".pre-commit-config.yaml" ||
        x === ".pre-commit-config.yml",
    )
  )
    return true;
  const claudeSettings = p.get(".claude/settings.json");
  return Boolean(claudeSettings && /"hooks"\s*:/.test(claudeSettings));
}

const dimScore = (report: ScanReport, id: string): number => report.dimensions.find((d) => d.id === id)?.score ?? 0;

function detectSelfVerify(p: ReturnType<typeof probes>): AppPassport["automationReadiness"]["selfVerify"] {
  const s = p.scripts;
  const has = (...keys: string[]) => keys.some((k) => typeof s[k] === "string" && s[k].trim().length > 0);
  return {
    build: has("build"),
    test: has("test"),
    lint: has("lint"),
    typecheck: has("typecheck", "type-check", "tsc"),
  };
}

// Tool-name alternations sourced from the single AI vocabulary (ai-tools.ts) so passport's
// "AI in workflow" recognizes the same tools as commit/PR attribution; keeps the `[bot]`
// co-author clause this detector also matched on.
const AI_WORKFLOW_TRAILER = new RegExp(
  `co-authored-by:\\s*(${AI_TOOL_ALT}|.*\\[bot\\])|generated with \\[?(${AI_TOOL_ALT})|(${AI_TOOL_ALT})`,
  "i",
);

function detectAiInWorkflow(snap: Snap, prStats: PrStats | null | undefined): boolean {
  const trailer = snap.commits.some((c) => AI_WORKFLOW_TRAILER.test(c.message ?? ""));
  return trailer || (prStats?.aiInvolvedRate ?? 0) > 0;
}

// ── production sub-scales ──────────────────────────────────────────────────────────────────────────
// "gated" rungs require branch protection (gov) — a token-only fact. enforced=null ⇒ cap at "present".
function detectCi(p: ReturnType<typeof probes>, gov: Governance | null | undefined): AppPassport["productionReadiness"]["ci"] {
  const workflows = p.hasPath((x) => /^\.github\/workflows\/.+\.ya?ml$/.test(x));
  if (!workflows) return { level: "none", provider: null, gates: [] };
  const t = p.workflowText;
  const hasChecks = /\b(test|lint|typecheck|tsc|vitest|jest|pytest|eslint)\b/.test(t);
  const hasDeploy = /\b(deploy|vercel|release|publish|cd)\b/.test(t);
  const enforced = Boolean(gov?.readable && gov.protected && gov.requiresStatusChecks);
  const gates = enforced ? (["lint", "typecheck", "test", "build"] as string[]).filter((g) => t.includes(g)) : [];
  const level = !hasChecks
    ? "build"
    : enforced && hasDeploy
      ? "delivery"
      : enforced
        ? "gated"
        : "checks"; // tokenless / unenforced cap: cannot claim gated/delivery
  return { level, provider: "github-actions", gates };
}

function detectTests(report: ScanReport, p: ReturnType<typeof probes>): AppPassport["productionReadiness"]["tests"] {
  const frameworks = (["vitest", "jest", "playwright", "cypress", "mocha", "@playwright/test", "pytest"] as string[])
    .filter((f) => p.hasDep(f))
    .map((f) => f.replace("@playwright/test", "playwright"));
  const d2 = dimScore(report, "D2");
  const level = d2 < 20 || frameworks.length === 0 ? "none" : d2 < 40 ? "smoke" : d2 < 60 ? "partial" : d2 < 80 ? "substantial" : "comprehensive";
  return { level, coveragePct: null, frameworks: [...new Set(frameworks)], criticalPathCovered: d2 >= 60 };
}

function detectSecurity(p: ReturnType<typeof probes>, gov: Governance | null | undefined): AppPassport["productionReadiness"]["security"] {
  const tools: string[] = [];
  if (p.hasPath((x) => x === "security.md" || x.endsWith("/security.md"))) tools.push("SECURITY.md");
  if (p.hasPath((x) => x === ".github/dependabot.yml" || x === ".github/dependabot.yaml")) tools.push("dependabot");
  if (p.workflowText.includes("codeql")) tools.push("codeql");
  if (p.workflowText.includes("gitleaks") || p.hasDep("gitleaks")) tools.push("gitleaks");
  if (p.workflowText.includes("trivy")) tools.push("trivy");
  const hasSbomOrSign = p.workflowText.includes("cosign") || p.workflowText.includes("syft") || p.workflowText.includes("sbom");
  const scanning = tools.some((t) => t === "dependabot" || t === "codeql" || t === "gitleaks" || t === "trivy");
  const enforced = Boolean(gov?.readable && gov.protected && gov.requiresStatusChecks);
  const level = hasSbomOrSign
    ? "supply-chain"
    : scanning && enforced
      ? "gated"
      : scanning
        ? "scanning"
        : tools.includes("SECURITY.md")
          ? "policy"
          : "none";
  return { level, tools };
}

/** 0.4.0: goes through isNamed, NOT truthiness. `unknown` is a truthy string, so the old test would
 *  have promoted an un-inspected repo straight to "tracing" — the exact fabrication the three-valued
 *  encoding exists to prevent. When the monitoring evidence is unknown the rung stays at its floor and
 *  buildPassport emits the evidence-limit finding instead of the "zero observability" one. */
function detectObservability(monitoring: AppPassport["stack"]["monitoring"]): AppPassport["productionReadiness"]["observability"] {
  const level = isNamed(monitoring.tracing)
    ? "tracing"
    : isNamed(monitoring.metrics)
      ? "metrics"
      : isNamed(monitoring.errorTracking)
        ? "errors"
        : isNamed(monitoring.logs)
          ? "logs"
          : "none";
  return { level };
}

function detectDelivery(p: ReturnType<typeof probes>, persistence: AppPassport["stack"]["persistence"]): AppPassport["productionReadiness"]["delivery"] {
  const migrations = persistence.some((x) => x.migrations === "versioned")
    ? "versioned"
    : persistence.some((x) => x.migrations === "scripted")
      ? "scripted"
      : "none";
  const iac = p.hasPath((x) => x.endsWith(".tf") || x.includes("/cdk.") || x === "pulumi.yaml");
  return { migrations, iac, rollback: false };
}

/** Mint a finding id. The id is the CAUSE, never the wording: `prod.zero-observability` stays the same
 *  id after the sentence is rewritten, which is the whole point — an owner decline and a fleet rollup
 *  bucket both join on it, and before 0.4.0 they joined on the prose instead, so a copy edit silently
 *  detached every decline made against a blocker and split one rollup bucket into two. */
const mint = (axis: "auto" | "prod", code: string, severity: PassportFinding["severity"], text: string): PassportFinding => ({
  id: `${axis}.${code}`,
  code,
  text,
  severity,
});

/**
 * Build the App Readiness Passport for a finished scan. Pure + deterministic over (report, snapshot).
 */
export function buildPassport(report: ScanReport, snap: Snap): AppPassport {
  const p = probes(snap);
  const gov = report.governance;
  const tokenless = gov == null; // no branch-protection visibility (anonymous/tokenless scan)

  const stack = detectStackBlock(snap, report.techStack, p);
  const artifacts = detectArtifacts(p);
  const selfVerify = detectSelfVerify(p);
  const aiInWorkflow = detectAiInWorkflow(snap, report.prStats);

  // automationReadiness reuses the L1–L5 maturity ladder directly (design §2a).
  const autoFindings: PassportFinding[] = [];
  const auto = (code: string, severity: PassportFinding["severity"], text: string) => autoFindings.push(mint("auto", code, severity, text));
  if (!artifacts.manifest) auto("no-manifest", "warn", "No in-repo .ai/manifest.yaml (agent-facing capability contract).");
  if (artifacts.contextGraph === "none") auto("no-context-graph", "warn", "No machine-readable context graph (context-map.json / CONTEXT.md).");
  if (artifacts.memory === "none") auto("no-memory", "warn", "No agent memory (.ai/memory): decisions and gotchas aren't carried between sessions.");
  if (artifacts.skills === "none") auto("no-skills", "info", "No reusable agent skills library (.claude/skills), so repeated work is re-prompted each time.");
  if (!aiInWorkflow) auto("no-ai-in-workflow", "info", "No evidence AI is actually used (no AI co-author trailers / agent PRs).");
  const selfVerifyGaps = (Object.entries(selfVerify) as [string, boolean][]).filter(([, v]) => !v).map(([k]) => k);
  // block, not warn: without a self-check an agent cannot tell a working change from a broken one.
  if (selfVerifyGaps.length) auto("self-verify-gaps", "block", `Agent can't self-verify: missing ${selfVerifyGaps.join(", ")} script(s).`);

  const ci = detectCi(p, gov);
  const tests = detectTests(report, p);
  const security = detectSecurity(p, gov);
  const observability = detectObservability(stack.monitoring);
  const delivery = detectDelivery(p, stack.persistence);
  const { score: prodScore, band } = deriveProductionScore({ ci, tests, security, observability, delivery });

  const prodFindings: PassportFinding[] = [];
  const prod = (code: string, severity: PassportFinding["severity"], text: string) => prodFindings.push(mint("prod", code, severity, text));
  // 0.4.0: "we looked and found nothing" and "we could not look" are different findings with different
  // severities. Claiming the first when the second is true reports OUR coverage hole as THEIR gap.
  if (stack.monitoring.errorTracking === UNKNOWN_CAPABILITY) {
    prod("observability-unassessable", "info", "Observability could not be assessed: no readable package.json on this scan, so monitoring dependencies were never inspected.");
  } else if (observability.level === "none") {
    prod("zero-observability", "block", "Zero observability: no error tracking, structured logs, metrics, or tracing.");
  }
  if (ci.level === "checks" || ci.level === "build" || ci.level === "none") prod("ci-not-gating", "block", "CI does not gate merges (no enforced required checks).");
  if (security.level === "none" || security.level === "policy") prod("no-security-scanning", "block", "No dependency/secret/SAST scanning wired in.");
  if (tokenless) prod("enforcement-not-observable", "info", "Enforcement (branch protection) not observable on this scan. CI/security capped at their present rung.");

  const pp: AppPassport = {
    passport: "app-passport",
    passportVersion: PASSPORT_VERSION,
    generatedAt: report.scannedAt.slice(0, 10),
    generatedBy: "ascent-scan",
    identity: {
      name: report.repo.name,
      slug: report.repo.name.toLowerCase(),
      purpose: report.repo.description?.trim() || `${report.repo.owner}/${report.repo.name}`,
      repo: report.repo.url,
      owner: report.repo.owner,
      ...(p.pkg?.version && typeof p.pkg.version === "string" ? { version: p.pkg.version } : {}),
      archetype: report.archetype,
      visibility: report.repo.isPrivate ? "private" : "public",
      license: report.repo.license ?? null,
    },
    stack,
    automationReadiness: {
      level: report.level.id as AutomationLevel,
      score: report.overallScore,
      artifacts,
      selfVerify,
      aiInWorkflow,
      // `blockers` stays the rendered projection so every pre-0.4.0 reader is untouched; `findings`
      // is the machine list, and it is what a decline or a rollup bucket must key on.
      blockers: autoFindings.map((f) => f.text),
      findings: autoFindings,
    },
    productionReadiness: {
      band,
      score: prodScore,
      ci,
      tests,
      security,
      observability,
      delivery,
      blockers: prodFindings.map((f) => f.text),
      findings: prodFindings,
    },
    links: {
      report: `/report?repo=${encodeURIComponent(`${report.repo.owner}/${report.repo.name}`)}`,
      ...(artifacts.contextGraph === "full" ? { contextMap: "context-map.json" } : {}),
      ...(artifacts.manifest ? { manifest: ".ai/manifest.yaml" } : {}),
    },
    evidence: {
      // Whole-artifact: "how much of the app could be inspected at all". Unchanged.
      confidence: report.confidence,
      source: tokenless ? "static-scan (no branch-protection visibility)" : "static-scan",
      files: ["package.json", ".github/workflows/", "prisma/schema.prisma"].filter((f) =>
        f.endsWith("/") ? p.hasPath((x) => x.startsWith(f.toLowerCase())) : p.get(f) !== undefined,
      ),
      // 0.4.0: per-field, so a guessed field and an observed one stop looking equally authoritative.
      fields: fieldEvidence(p),
    },
  };
  // 0.3.0: the autonomy tier is a projection OF the passport (+ live governance), derived last so
  // it reads the exact fields persisted above — never a second, drifting computation.
  pp.autonomy = deriveAutonomyTier(pp, gov ?? null);
  return pp;
}

/** Tolerant parse of a persisted passport JSON blob — null on missing/malformed (read-path degrade).
 *  THE version-migration seam: every read path (export route, org rollup, personal passports, the report
 *  page) funnels through here, so a stored 0.1.0 row is lifted to the current shape exactly once, right
 *  where it is deserialized. See passport-migrate.ts. */
export function parsePassportJson(raw: string | null | undefined): AppPassport | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<AppPassport>;
    if (v && v.passport === "app-passport" && v.identity && v.automationReadiness && v.productionReadiness) {
      return upgradePassport(v as AppPassport);
    }
    return null;
  } catch {
    return null;
  }
}
