// App Readiness Passport builder (see APP_READINESS_PASSPORT.md + app-passport.schema.json). A PURE,
// deterministic projection of a finished scan: it re-shapes the report + snapshot into the descriptive,
// tool-NAMING passport (the human/portfolio scorecard, sibling to the agent-facing .ai/manifest). Like
// extractTechStack it is DISPLAY/PERSIST-ONLY — never fed to the prompt or the score, so scans stay
// byte-identical. Determinism is load-bearing: snapshot+report only, no Date.now/IO/random.
//
// PRESENT vs ENFORCED is the design's core distinction and the token boundary: the "gated" rungs of CI
// and Security require branch protection (report.governance), which is null on a tokenless scan. When
// governance is absent we HONESTLY CAP ci/security at the present rung and say so in evidence/blockers —
// never claim an enforcement we couldn't observe. See docs/concepts/2026-06-22-app-passport-scan-integration.md.

import type { AppPassport, AutomationLevel, Governance, PrStats, ProductionBand, RepoSnapshot, ScanReport, TechStack } from "@/lib/types";

export type { AppPassport, AutomationLevel, ProductionBand } from "@/lib/types";

export const PASSPORT_VERSION = "0.1.0";

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
  return { get, hasPath, lowerPaths, pkg, deps, hasDep, hasDepPrefix, workflowText, scripts };
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

  const errorTracking = p.hasDepPrefix("@sentry/") ? "sentry" : p.hasDep("rollbar") ? "rollbar" : p.hasDep("@bugsnag/js") ? "bugsnag" : null;
  const logs = p.hasDep("pino") ? "pino" : p.hasDep("winston") ? "winston" : null;
  const metrics = p.hasDep("prom-client") ? "prometheus" : p.hasDep("dd-trace") || p.hasDepPrefix("@datadog/") ? "datadog" : null;
  const tracing = p.hasDepPrefix("@opentelemetry/") ? "otel" : null;
  const uptime = p.hasPath((x) => /(^|\/)api\/health(\/|\.|$)/.test(x)) ? "/api/health" : null;

  const hosting = p.get("vercel.json") !== undefined || p.hasPath((x) => x === ".vercel" || x.startsWith(".vercel/"))
    ? "vercel"
    : p.hasPath((x) => x.endsWith("fly.toml"))
      ? "fly"
      : p.hasPath((x) => x.endsWith("netlify.toml"))
        ? "netlify"
        : p.hasPath((x) => x === "dockerfile" || x.endsWith("/dockerfile"))
          ? "container"
          : null;

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
  const memory = p.hasPath((x) => x.startsWith(".ai/memory") || x.startsWith(".claude/memory"));
  const manifest = p.hasPath((x) => x === ".ai/manifest.yaml" || x === ".ai/manifest.yml");
  const evals = p.hasPath((x) => /(^|\/)(eval|evals|golden)(\/|s?\.)/.test(x) || x.includes(".golden.")) ? "partial" : "none";
  const skills = p.hasPath((x) => x.startsWith(".claude/skills/") || (x.startsWith("skills/") && x.endsWith("skill.md")));
  return { agentInstructions, contextGraph, memory, manifest, evals, skills };
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

function detectAiInWorkflow(snap: Snap, prStats: PrStats | null | undefined): boolean {
  const trailer = snap.commits.some((c) => /co-authored-by:\s*(claude|.*\[bot\])|generated with \[?claude|copilot/i.test(c.message ?? ""));
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

function detectObservability(monitoring: AppPassport["stack"]["monitoring"]): AppPassport["productionReadiness"]["observability"] {
  const level = monitoring.tracing
    ? "tracing"
    : monitoring.metrics
      ? "metrics"
      : monitoring.errorTracking
        ? "errors"
        : monitoring.logs
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

// Derived production score (design §8.3 — derive, don't author). Documented contributions per sub-scale,
// weighted; band by the same 0/25/45/65/85 cutoffs as the L-ladder.
const CI_PTS: Record<string, number> = { none: 0, build: 20, checks: 45, gated: 70, delivery: 85, progressive: 100 };
const TEST_PTS: Record<string, number> = { none: 0, smoke: 25, partial: 50, substantial: 75, comprehensive: 100 };
const SEC_PTS: Record<string, number> = { none: 0, policy: 25, scanning: 50, gated: 75, "supply-chain": 100 };
const OBS_PTS: Record<string, number> = { none: 0, logs: 40, errors: 60, metrics: 80, tracing: 100 };

function productionScore(pr: Omit<AppPassport["productionReadiness"], "band" | "score" | "blockers">): { score: number; band: ProductionBand } {
  const deliv = (pr.delivery.migrations === "versioned" ? 50 : pr.delivery.migrations === "scripted" ? 25 : 0) + (pr.delivery.iac ? 25 : 0) + (pr.delivery.rollback ? 25 : 0);
  const score = Math.round(
    0.25 * (CI_PTS[pr.ci.level] ?? 0) +
      0.25 * (TEST_PTS[pr.tests.level] ?? 0) +
      0.2 * (SEC_PTS[pr.security.level] ?? 0) +
      0.15 * (OBS_PTS[pr.observability.level] ?? 0) +
      0.15 * Math.min(100, deliv),
  );
  const band: ProductionBand = score < 25 ? "prototype" : score < 45 ? "internal" : score < 65 ? "beta" : score < 85 ? "production" : "hardened";
  return { score, band };
}

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
  const autoBlockers: string[] = [];
  if (!artifacts.manifest) autoBlockers.push("No in-repo .ai/manifest.yaml (agent-facing capability contract).");
  if (artifacts.contextGraph === "none") autoBlockers.push("No machine-readable context graph (context-map.json / CONTEXT.md).");
  if (!aiInWorkflow) autoBlockers.push("No evidence AI is actually used (no AI co-author trailers / agent PRs).");
  const selfVerifyGaps = (Object.entries(selfVerify) as [string, boolean][]).filter(([, v]) => !v).map(([k]) => k);
  if (selfVerifyGaps.length) autoBlockers.push(`Agent can't self-verify: missing ${selfVerifyGaps.join(", ")} script(s).`);

  const ci = detectCi(p, gov);
  const tests = detectTests(report, p);
  const security = detectSecurity(p, gov);
  const observability = detectObservability(stack.monitoring);
  const delivery = detectDelivery(p, stack.persistence);
  const { score: prodScore, band } = productionScore({ ci, tests, security, observability, delivery });

  const prodBlockers: string[] = [];
  if (observability.level === "none") prodBlockers.push("Zero observability: no error tracking, structured logs, metrics, or tracing.");
  if (ci.level === "checks" || ci.level === "build" || ci.level === "none") prodBlockers.push("CI does not gate merges (no enforced required checks).");
  if (security.level === "none" || security.level === "policy") prodBlockers.push("No dependency/secret/SAST scanning wired in.");
  if (tokenless) prodBlockers.push("Enforcement (branch protection) not observable on this scan — CI/security capped at their present rung.");

  return {
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
      blockers: autoBlockers,
    },
    productionReadiness: { band, score: prodScore, ci, tests, security, observability, delivery, blockers: prodBlockers },
    links: {
      report: `/report?repo=${encodeURIComponent(`${report.repo.owner}/${report.repo.name}`)}`,
      ...(artifacts.contextGraph === "full" ? { contextMap: "context-map.json" } : {}),
      ...(artifacts.manifest ? { manifest: ".ai/manifest.yaml" } : {}),
    },
    evidence: {
      confidence: report.confidence,
      source: tokenless ? "static-scan (no branch-protection visibility)" : "static-scan",
      files: ["package.json", ".github/workflows/", "prisma/schema.prisma"].filter((f) =>
        f.endsWith("/") ? p.hasPath((x) => x.startsWith(f.toLowerCase())) : p.get(f) !== undefined,
      ),
    },
  };
}

/** Tolerant parse of a persisted passport JSON blob — null on missing/malformed (read-path degrade). */
export function parsePassportJson(raw: string | null | undefined): AppPassport | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<AppPassport>;
    if (v && v.passport === "app-passport" && v.identity && v.automationReadiness && v.productionReadiness) {
      return v as AppPassport;
    }
    return null;
  } catch {
    return null;
  }
}
