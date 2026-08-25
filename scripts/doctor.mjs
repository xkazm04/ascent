#!/usr/bin/env node
/** `npm run doctor` — preflight that maps the env matrix to enabled product surfaces.
 *
 *  Loads .env.local / .env exactly like `next dev` does (@next/env), probes the machine
 *  (Node, git, the `claude` CLI, docker's ascent-db, the PGlite data dir) and prints a
 *  capability × status table: what runs, what runs degraded-with-a-fallback, what is off,
 *  and the ONE action that would change each row. Honest wording is the contract —
 *  "off" is a valid state, and mock mode is a feature (a real deterministic score with
 *  zero config), not a failure.
 *
 *  Reads env + cheap local probes only — no model calls, no DB connections, no writes.
 *  NEVER prints secret values (presence + last-4 at most). Always exits 0: this is a
 *  report, not a gate.
 *
 *  Run:  npm run doctor
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();

// @next/env ships inside the `next` package tree — no new dependency. It is CJS; depending
// on interop the function lives on the module or on .default.
const require = createRequire(import.meta.url);
const nextEnv = require("@next/env");
const loadEnvConfig = nextEnv.loadEnvConfig ?? nextEnv.default?.loadEnvConfig;
loadEnvConfig(ROOT, true, { info: () => {}, error: console.error });

const env = process.env;
const set = (v) => typeof v === "string" && v.trim() !== "";
/** Presence marker for a secret — never the value; last 4 chars at most. */
const mask = (v) => (set(v) ? `set (…${v.trim().slice(-4)})` : "unset");

// ── Machine probes (best-effort, cheap, short timeouts) ──────────────────────

function probeCmd(cmd, args) {
  try {
    const res = spawnSync(cmd, args, {
      encoding: "utf8",
      timeout: 10_000,
      shell: process.platform === "win32",
    });
    if (res.status === 0 && res.stdout) return res.stdout.trim().split("\n")[0];
  } catch {
    /* not installed */
  }
  return null;
}

/** Is the docker-compose `ascent-db` container running? Cheap `docker ps` filter; any
 *  failure (no docker, daemon down) reads as "unknown" — never an error. */
function probeDockerDb() {
  const out = probeCmd("docker", ["ps", "--filter", "name=ascent-db", "--format", "{{.Names}}"]);
  if (out == null) return null; // docker unavailable → unknown
  return out.includes("ascent-db");
}

const probes = {
  nodeVersion: process.version,
  git: probeCmd("git", ["--version"]),
  claudeCli: probeCmd("claude", ["--version"]),
  codexCli: probeCmd("codex", ["--version"]),
  dockerDb: probeDockerDb(),
  pgliteDir: set(env.PGLITE_DATA_DIR) && existsSync(join(ROOT, env.PGLITE_DATA_DIR)),
};

// ── Predicates mirrored from src/lib (keep in sync — each names its source) ──

// src/lib/env.ts selfHosted(): explicit flag wins; unset → self-hosted iff billing unconfigured.
function selfHosted() {
  const raw = (env.ASCENT_SELF_HOSTED ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return !set(env.POLAR_ACCESS_TOKEN);
}
// src/lib/llm/config.ts cliProviderAllowed(): dev always; production only when self-hosted.
const cliAllowed = env.NODE_ENV !== "production" || selfHosted();
// src/lib/llm/local.ts localLlmConfigured(): BOTH knobs required.
const localLlm = set(env.LOCAL_LLM_BASE_URL) && set(env.LOCAL_LLM_MODEL);
const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;

// src/lib/llm/index.ts — the `auto` ladder: gemini key → configured local server → mock.
function resolveAutoEngine() {
  if (set(geminiKey)) return { id: "gemini", detail: `Gemini (${mask(geminiKey)})` };
  if (localLlm) return { id: "local", detail: `local server ${env.LOCAL_LLM_BASE_URL} · ${env.LOCAL_LLM_MODEL}` };
  return { id: "mock", detail: "mock — deterministic, keyless" };
}

// ── The capability rows ──────────────────────────────────────────────────────
// status: "ready" (✓ works now) | "fallback" (◐ works via a degraded/fallback path) | "off" (○)
const rows = [];
const row = (capability, status, detail, action) => rows.push({ capability, status, detail, action });

// --- Runtime -----------------------------------------------------------------
{
  // package.json engines: node >=20
  const engines = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).engines?.node ?? ">=20";
  const major = Number(/^v?(\d+)/.exec(probes.nodeVersion)?.[1] ?? 0);
  const minMajor = Number(/(\d+)/.exec(engines)?.[1] ?? 20);
  if (major >= minMajor) {
    row("Node.js runtime", "ready", `${probes.nodeVersion} (engines ${engines})`);
  } else {
    row("Node.js runtime", "off", `${probes.nodeVersion} — package.json asks for ${engines}`, `Install Node ${engines}.`);
  }
  if (probes.git) row("git", "ready", probes.git);
  else row("git", "off", "git not found on PATH — cloning repos for scans will fail", "Install git.");
}

// --- LLM engine (the resolution ladder) --------------------------------------
{
  const choice = (env.LLM_PROVIDER ?? "").trim().toLowerCase() || "auto";
  const known = ["auto", "gemini", "bedrock", "openai", "openrouter", "local", "mock", "claude-cli", "codex-cli"];
  if (!known.includes(choice)) {
    row("LLM engine", "off", `LLM_PROVIDER="${env.LLM_PROVIDER}" is unknown — every scan will refuse (fail-loud by design)`,
      `Fix or unset LLM_PROVIDER (one of ${known.join(", ")}).`);
  } else if (choice === "auto") {
    const auto = resolveAutoEngine();
    if (auto.id === "mock") {
      row("LLM engine", "fallback", "auto → mock: zero-config floor — scans WORK and are deterministic, just without LLM-written nuance",
        "Set GEMINI_API_KEY (aistudio.google.com/apikey), or LOCAL_LLM_BASE_URL + LOCAL_LLM_MODEL for a local Ollama/vLLM/LM Studio, or LLM_PROVIDER=claude-cli.");
    } else {
      row("LLM engine", "ready", `auto → ${auto.detail}`);
    }
  } else if (choice === "gemini") {
    if (set(geminiKey)) row("LLM engine", "ready", `gemini (${mask(geminiKey)} · model ${env.GEMINI_MODEL || "gemini-3-flash-preview default"})`);
    else row("LLM engine", "off", "LLM_PROVIDER=gemini but no GEMINI_API_KEY/GOOGLE_API_KEY — assess() fails loud, scans degrade to mock with a caveat",
      "Set GEMINI_API_KEY (aistudio.google.com/apikey) or unset LLM_PROVIDER.");
  } else if (choice === "local") {
    if (localLlm) row("LLM engine", "ready", `local — ${env.LOCAL_LLM_BASE_URL} · ${env.LOCAL_LLM_MODEL} ($0/token, nothing leaves the box)`);
    else row("LLM engine", "off", "LLM_PROVIDER=local but LOCAL_LLM_BASE_URL and/or LOCAL_LLM_MODEL missing (both required, no guessed defaults)",
      "Set LOCAL_LLM_BASE_URL (e.g. http://localhost:11434/v1) + LOCAL_LLM_MODEL (the exact tag you pulled).");
  } else if (choice === "claude-cli") {
    if (probes.claudeCli && cliAllowed) row("LLM engine", "ready", `claude-cli — ${probes.claudeCli}, runs on your subscription (model ${env.CLAUDE_MODEL || "sonnet"})`);
    else if (!probes.claudeCli) row("LLM engine", "off", "LLM_PROVIDER=claude-cli but no `claude` binary on PATH",
      "Install Claude Code and log in (`claude /login`).");
    else row("LLM engine", "off", "claude-cli refused: NODE_ENV=production without self-hosted mode (cliProviderAllowed)",
      "Set ASCENT_SELF_HOSTED=1 on a box you own, or pick another LLM_PROVIDER.");
  } else if (choice === "codex-cli") {
    if (probes.codexCli && cliAllowed) row("LLM engine", "ready", `codex-cli — ${probes.codexCli}, runs on your ChatGPT plan (model ${env.CODEX_MODEL || "the CLI's own default"})`);
    else if (!probes.codexCli) row("LLM engine", "off", "LLM_PROVIDER=codex-cli but no `codex` binary on PATH",
      "Install the OpenAI Codex CLI and log in (`codex login`).");
    else row("LLM engine", "off", "codex-cli refused: NODE_ENV=production without self-hosted mode (cliProviderAllowed)",
      "Set ASCENT_SELF_HOSTED=1 on a box you own, or pick another LLM_PROVIDER.");
  } else if (choice === "openai") {
    row("LLM engine", set(env.OPENAI_API_KEY) ? "ready" : "off",
      set(env.OPENAI_API_KEY) ? `openai (${mask(env.OPENAI_API_KEY)} · ${env.OPENAI_MODEL || "gpt-4o-mini"})` : "LLM_PROVIDER=openai but OPENAI_API_KEY unset",
      set(env.OPENAI_API_KEY) ? undefined : "Set OPENAI_API_KEY (or OPENAI_BASE_URL for a compatible endpoint).");
  } else if (choice === "openrouter") {
    row("LLM engine", set(env.OPENROUTER_API_KEY) ? "ready" : "off",
      set(env.OPENROUTER_API_KEY) ? `openrouter (${mask(env.OPENROUTER_API_KEY)})` : "LLM_PROVIDER=openrouter but OPENROUTER_API_KEY unset",
      set(env.OPENROUTER_API_KEY) ? undefined : "Set OPENROUTER_API_KEY.");
  } else if (choice === "bedrock") {
    const awsSignal = env.BEDROCK_REGION || env.AWS_REGION || env.AWS_DEFAULT_REGION || env.AWS_ACCESS_KEY_ID || env.AWS_PROFILE;
    row("LLM engine", set(awsSignal) ? "ready" : "off",
      set(awsSignal) ? `bedrock (region ${env.BEDROCK_REGION || env.AWS_REGION || "us-east-1 default"} · ${env.BEDROCK_MODEL_ID || "claude-sonnet default"})` : "LLM_PROVIDER=bedrock but no AWS region/credential signal in env",
      set(awsSignal) ? undefined : "Set BEDROCK_REGION + AWS credentials (key pair, profile, or role).");
  } else {
    row("LLM engine", "fallback", "mock (explicit) — deterministic, keyless; every score is the rubric floor plus static analysis");
  }
}

// --- Claude CLI (its own row: claude-cli provider + autopilot both need it) ---
if (probes.claudeCli) {
  row("Claude CLI", "ready", `${probes.claudeCli} — usable as LLM_PROVIDER=claude-cli${cliAllowed ? "" : " (but refused: production without ASCENT_SELF_HOSTED=1)"}`);
} else {
  row("Claude CLI", "off", "`claude` not found on PATH — claude-cli provider and autopilot unavailable",
    "Install Claude Code and log in; scans still work via the other providers/mock.");
}

// --- Codex CLI (assessment seam only: usable as LLM_PROVIDER=codex-cli, never the autopilot) ---
if (probes.codexCli) {
  row("Codex CLI", "ready", `${probes.codexCli} — usable as LLM_PROVIDER=codex-cli${cliAllowed ? "" : " (but refused: production without ASCENT_SELF_HOSTED=1)"}`);
} else {
  row("Codex CLI", "off", "`codex` not found on PATH — codex-cli provider unavailable",
    "Install the OpenAI Codex CLI and log in; scans still work via the other providers/mock.");
}

// --- Database / persistence --------------------------------------------------
{
  const pglite = set(env.PGLITE_DATA_DIR);
  if (pglite) {
    row("Database (persistence, org features)", "ready",
      `embedded PGlite at ${env.PGLITE_DATA_DIR}${probes.pgliteDir ? " (data dir exists)" : " (fresh — created on first `npm run dev`)"}` +
        (probes.dockerDb === true ? " · note: docker ascent-db is ALSO running" : ""));
  } else if (set(env.DATABASE_URL)) {
    const dockerNote =
      probes.dockerDb === true ? " · docker ascent-db container is running" :
      probes.dockerDb === false ? " · docker ascent-db container NOT running" : "";
    row("Database (persistence, org features)", "ready", `DATABASE_URL configured (value not shown)${dockerNote}`,
      probes.dockerDb === false && /localhost|127\.0\.0\.1/.test(env.DATABASE_URL) ? "If this points at docker-compose: `docker compose up -d db`." : undefined);
  } else {
    row("Database (persistence, org features)", "off", "no PGLITE_DATA_DIR or DATABASE_URL — anonymous public scans still work; history/org dashboards don't persist",
      "Easiest: set PGLITE_DATA_DIR=.pglite/ascent + a dummy DATABASE_URL (see .env.example).");
  }
}

// --- GitHub ------------------------------------------------------------------
row("GitHub token (rate limits, PR/governance signals)",
  set(env.GITHUB_TOKEN) ? "ready" : "fallback",
  set(env.GITHUB_TOKEN) ? `GITHUB_TOKEN ${mask(env.GITHUB_TOKEN)}` : "unset — public scans work on anonymous API limits (60 req/h; big repos may throttle)",
  set(env.GITHUB_TOKEN) ? undefined : "Create a fine-grained read-only token (Contents+Metadata) → GITHUB_TOKEN.");
{
  const appVars = ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_WEBHOOK_SECRET"];
  const missing = appVars.filter((k) => !set(env[k]));
  if (missing.length === 0) row("GitHub App (private/org repos)", "ready", `app id ${env.GITHUB_APP_ID} · key + webhook secret set`);
  else if (missing.length < appVars.length) row("GitHub App (private/org repos)", "off", `partial config — missing ${missing.join(", ")}`,
    "Complete the trio (docs/features/github/setup.md) or unset all three.");
  else row("GitHub App (private/org repos)", "off", "not configured — public-repo scanning is unaffected",
    "Install a GitHub App (docs/features/github/setup.md) to scan private/org repos.");
}

// --- Sign-in wall ------------------------------------------------------------
{
  const supabase = set(env.NEXT_PUBLIC_SUPABASE_URL) && set(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const bypass = env.NODE_ENV !== "production" && (env.ASCENT_AUTH_BYPASS === "1" || env.ASCENT_AUTH_BYPASS === "true");
  if (supabase && !bypass) row("Sign-in (Supabase GitHub OAuth)", "ready", `wall enforced — ${env.NEXT_PUBLIC_SUPABASE_URL}`);
  else if (supabase && bypass) row("Sign-in (Supabase GitHub OAuth)", "fallback", "configured, but ASCENT_AUTH_BYPASS drops the wall (dev-only; hard-disabled in production)",
    "Unset ASCENT_AUTH_BYPASS to exercise the real flow.");
  else row("Sign-in (Supabase GitHub OAuth)", "off", "no Supabase pair — app runs open; private/org features have no login",
    "Set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).");
}

// --- Deployment mode + billing ----------------------------------------------
{
  const raw = (env.ASCENT_SELF_HOSTED ?? "").trim();
  const how = raw ? `ASCENT_SELF_HOSTED=${raw}` : set(env.POLAR_ACCESS_TOKEN) ? "implicit: billing configured" : "implicit: no billing configured";
  row("Deployment mode", "ready", selfHosted()
    ? `SELF-HOSTED (${how}) — no plan gates, unmetered scans, BYOM/white-label/PDF all on`
    : `CLOUD (${how}) — plan tiers + scan credits enforced`);
  const polar = set(env.POLAR_ACCESS_TOKEN) && set(env.POLAR_CREDIT_PACKS);
  if (polar) row("Billing (Polar credit packs)", "ready", `token ${mask(env.POLAR_ACCESS_TOKEN)} · packs configured · ${env.POLAR_SERVER === "production" ? "production" : "sandbox"}`);
  else if (set(env.POLAR_ACCESS_TOKEN)) row("Billing (Polar credit packs)", "off", "POLAR_ACCESS_TOKEN set but POLAR_CREDIT_PACKS missing — 'Buy credits' stays hidden",
    "Map product ids to credits in POLAR_CREDIT_PACKS (see .env.example).");
  else row("Billing (Polar credit packs)", "off", "not configured — a valid state: self-hosted deployments sell nothing",
    "Set POLAR_ACCESS_TOKEN + POLAR_WEBHOOK_SECRET + POLAR_CREDIT_PACKS to sell credits.");
}

// --- Scheduled routes --------------------------------------------------------
row("Scheduled routes (/api/cron/* — rescan, digest, purge)",
  set(env.CRON_SECRET) ? "ready" : "off",
  set(env.CRON_SECRET) ? "CRON_SECRET set — cron endpoints answer to the bearer token" : "no CRON_SECRET — cron endpoints answer 503 (fail-closed by design)",
  set(env.CRON_SECRET) ? undefined : "Set CRON_SECRET to any long random string; Vercel Cron sends it as a Bearer token.");

// --- Local mode: autopilot ---------------------------------------------------
{
  const flag = env.ASCENT_AUTOPILOT === "1" || env.ASCENT_AUTOPILOT === "true";
  if (flag && probes.claudeCli && cliAllowed) row("Autopilot (war-room dispatch loop)", "ready", "ASCENT_AUTOPILOT=1 + claude CLI present — sessions run in isolated worktrees");
  else if (flag && !probes.claudeCli) row("Autopilot (war-room dispatch loop)", "off", "ASCENT_AUTOPILOT set but no `claude` CLI on PATH", "Install Claude Code and log in.");
  else if (flag) row("Autopilot (war-room dispatch loop)", "off", "ASCENT_AUTOPILOT set but claude-cli is refused (production without self-hosted mode)", "Set ASCENT_SELF_HOSTED=1.");
  else row("Autopilot (war-room dispatch loop)", "off", "off by default — spawning an auto-editing agent is a deliberate opt-in",
    "Set ASCENT_AUTOPILOT=1 (needs the claude CLI + repos paired under Admin → Pairing).");
}

// ── Print --------------------------------------------------------------------

const MARK = { ready: "✓", fallback: "◐", off: "○" };
const LABEL = { ready: "ready", fallback: "fallback", off: "off" };

console.log("\nascent doctor — capability × status (env matrix → product surfaces)\n");
const width = Math.max(...rows.map((r) => r.capability.length)) + 2;
for (const r of rows) {
  console.log(`  ${MARK[r.status]} ${r.capability.padEnd(width)}${LABEL[r.status].padEnd(10)}${r.detail}`);
  if (r.action) console.log(`    ${" ".repeat(width)}↳ ${r.action}`);
}

const ready = rows.filter((r) => r.status === "ready").length;
const fb = rows.filter((r) => r.status === "fallback").length;
const off = rows.length - ready - fb;
console.log(
  `\n  ${ready}/${rows.length} ready` +
    (fb ? `, ${fb} on a fallback path` : "") +
    (off ? `, ${off} off` : "") +
    " — ↳ lines name the one action that changes a row. Mock mode and 'off' are valid states, not failures.\n",
);

// A report, not a gate.
process.exit(0);
