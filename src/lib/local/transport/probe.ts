// THE PREFLIGHT PROBE — is this arm's transport installed, authorized, and pointed at something that
// will answer HONESTLY? Proven without spending tokens, and proven THROUGH THE SAME SPAWN DOOR AND
// ENVIRONMENT the real run will use.
//
// The second clause is the one that earns its keep. These tools compute their own auth and capability
// report from the environment they are handed, so a probe run anywhere else describes a process
// nobody will launch. A probe that cannot be zero-cost says so; it never pretends.
//
// WHY THIS BLOCKS RATHER THAN WARNS. A comparison run costs hours of wall clock, and the two failures
// measured on this machine on 2026-09-21 both produce a RESULT rather than an error: a server left at
// its default context truncates the tool definitions, and the model then looks incapable of calling
// tools; and a server below the release that stopped the client's token-countdown message from
// breaking the key-value cache re-prefills the whole prompt every single turn, so the arm looks slow.
// Either one yields a confidently wrong verdict about a model — the most expensive answer available
// here — and a warning in an unattended overnight drive is a warning nobody reads.
//
// HOW EACH CHECK GETS ITS EVIDENCE (measured on this machine, 2026-09-21, Ollama 0.32.15 / claude
// 2.1.278 — every command below was run before it was written down):
//
//   binary         `<bin> --version` through the same spawn door (`shell: true`, `agentSpawnEnv`).
//   auth           `claude auth status` prints JSON — `{"loggedIn":true,"authMethod":"claude.ai",…}`
//                  — and spends nothing. A LOCAL arm does not use the Anthropic seat at all, so its
//                  auth question is instead "does the endpoint carry the token the client requires".
//   endpoint       `GET /api/version`.
//   model          `GET /api/tags`, matched on the server's own model id.
//   context        `GET /api/ps` — the LOADED context of a resident model. `/api/show` and
//                  `/api/tags` report `context_length` too, but that is the model's ARCHITECTURAL
//                  MAXIMUM (qwen2.5:7b answers 32768 there whatever the server is serving), and the
//                  question here is "what will THIS run get", which only the loaded instance answers.
//                  When the model is not resident we load it with a ZERO-TOKEN load call
//                  (`POST /api/generate {"model":…}` with no prompt, which returns
//                  `{"done_reason":"load"}` and generates nothing) and read `/api/ps` again. If even
//                  that does not yield a loaded context, the check FAILS rather than falling back to
//                  the maximum: a number that answers a different question is worse than no number.
//   server-version `GET /api/version`, compared to MIN_SERVER_VERSION.

import { spawn } from "node:child_process";
import type { TransportId } from "@/lib/local/arm";
import type { LocalEndpoint } from "@/lib/local/transport/run";
import { agentSpawnEnv } from "@/lib/local/agent";
import { transportProfile } from "@/lib/local/transport/profile";

/** One thing the probe checked. `ok: false` carries what to DO about it, not just what is wrong. */
export interface ProbeFinding {
  check: "binary" | "endpoint" | "model" | "context" | "server-version" | "auth";
  ok: boolean;
  /** What was observed. Absent when the check could not run at all. */
  observed?: string | null;
  /** What is required for this check to pass. */
  required?: string | null;
  /** The operator's next action, when `ok` is false. */
  remedy?: string | null;
}

export interface ProbeResult {
  transport: TransportId;
  /** Every check passed. A run may only be armed when this is true. */
  ok: boolean;
  /** The transport binary's version, recorded whether or not the probe passed — a capability matrix
   *  row is worthless without the version it was verified against. */
  binVersion?: string | null;
  /** The inference server's version, when the arm is a local one. */
  serverVersion?: string | null;
  findings: ProbeFinding[];
  /** ISO timestamp. Stamped onto the run as `probeJson` so a result carries what it ran under. */
  at: string;
  /** True when the probe itself consumed no model tokens. False means the figure below is real. */
  zeroToken: boolean;
}

/** The minimum declared context an arm may run with. Below this, tool definitions are truncated and
 *  the model's apparent incapacity is an artifact of the harness. */
export const MIN_CONTEXT_TOKENS = 65_536;

/**
 * The oldest inference-server release an arm may run against.
 *
 * Below 0.33.0 the client's "tokens left" countdown was moved to the FRONT of the prompt on every
 * request, which invalidates the key-value cache each turn: the arm re-prefills its whole context
 * every time and simply looks slow. That is a harness artifact wearing the costume of a model
 * verdict, so it is refused rather than noted.
 */
export const MIN_SERVER_VERSION = "0.33.0";

/** How long any one probe step may take. A probe that hangs is a probe nobody runs. */
const STEP_TIMEOUT_MS = 20_000;
/** The zero-token model load is the one slow step: a 27B at Q4 takes tens of seconds to become
 *  resident. The real run is about to pay this anyway. */
const LOAD_TIMEOUT_MS = 180_000;

// ── THE SPAWN DOOR ───────────────────────────────────────────────────────────────────────────────

interface BinOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run one short, read-only command through THE SAME DOOR a lane's session goes through: `shell: true`
 * (Windows ships `claude.cmd`), `windowsHide`, and `agentSpawnEnv(process.env)` — which strips the
 * `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT` markers that make a nested `claude` produce nothing at all.
 * A probe run with a different environment describes a process nobody will launch.
 *
 * Never rejects: a missing binary is a finding.
 */
function runBin(bin: string, args: string[], timeoutMs = STEP_TIMEOUT_MS): Promise<BinOutput> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (r: BinOutput) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, {
        shell: true,
        env: agentSpawnEnv(process.env),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      settle({ code: null, stdout: "", stderr: err instanceof Error ? err.message : String(err) });
      return;
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      settle({ code: null, stdout, stderr: stderr || `timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      if (stdout.length < 8_192) stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < 8_192) stderr += d.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      settle({ code: null, stdout, stderr: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      settle({ code, stdout, stderr });
    });
  });
}

// ── THE SERVER DOOR ──────────────────────────────────────────────────────────────────────────────

/**
 * The inference server's ADMIN root, from the Anthropic-compatible root the arm is pointed at.
 *
 * `LocalEndpoint.baseUrl` is what the CLI talks to; the capability endpoints (`/api/ps`,
 * `/api/tags`, `/api/version`) hang off the server itself, one level up from whatever compatibility
 * shim path the client uses. Stripping a trailing `/v1` or `/api` is the whole conversion.
 */
function serverRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/(v1|api)$/i, "");
}

async function getJson(url: string, timeoutMs = STEP_TIMEOUT_MS): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const list = (v: unknown, key: string): Record<string, unknown>[] => {
  const o = rec(v);
  const arr = o?.[key];
  return Array.isArray(arr) ? arr.map(rec).filter((r): r is Record<string, unknown> => r !== null) : [];
};

/** Ollama's `qwen3:27b` and `qwen3:27b-latest`-style ids compare equal once the implicit tag is written out. */
const sameModel = (a: string, b: string): boolean => {
  const norm = (s: string) => (s.includes(":") ? s : `${s}:latest`).toLowerCase();
  return norm(a) === norm(b);
};

/** Compare two dotted versions numerically. Returns true when `v` is at or above `min`. */
export function versionAtLeast(v: string | null | undefined, min: string): boolean {
  if (!v) return false;
  const parts = (s: string) => (s.trim().match(/\d+/g) ?? []).map(Number);
  const a = parts(v);
  const b = parts(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

// ── THE CHECKS ───────────────────────────────────────────────────────────────────────────────────

/** The profile's binary, or null when the transport registry is not available in this build. */
function binOf(transport: TransportId): { bin: string } | null {
  try {
    return { bin: transportProfile(transport).bin };
  } catch {
    return null;
  }
}

async function checkBinary(transport: TransportId): Promise<{ finding: ProbeFinding; version: string | null; bin: string | null }> {
  const profile = binOf(transport);
  if (!profile) {
    return {
      bin: null,
      version: null,
      finding: {
        check: "binary",
        ok: false,
        observed: null,
        required: `a registered profile for the "${transport}" transport`,
        remedy: `This build has no profile for "${transport}" — it cannot be armed.`,
      },
    };
  }
  const out = await runBin(profile.bin, ["--version"]);
  const version = out.stdout.trim().split(/\r?\n/)[0]?.trim() || null;
  if (out.code !== 0 || !version) {
    return {
      bin: profile.bin,
      version: null,
      finding: {
        check: "binary",
        ok: false,
        observed: out.stderr.trim().slice(0, 200) || `exit ${out.code}`,
        required: `\`${profile.bin} --version\` to answer`,
        remedy: `Install the ${transport} CLI, or point this deployment at it (the transport's own bin env var).`,
      },
    };
  }
  return { bin: profile.bin, version, finding: { check: "binary", ok: true, observed: version } };
}

/**
 * Auth, zero-token.
 *
 * A LOCAL arm never touches the Anthropic seat: the question is whether the endpoint carries the
 * token the client insists on (local servers ignore its value and reject its absence — see
 * `LocalEndpoint.token`). A CLOUD `claude` arm has a real zero-token proof in `claude auth status`,
 * which prints its JSON and spends nothing. Anything else has no zero-token proof this package could
 * verify, and says exactly that rather than passing on trust.
 */
async function checkAuth(transport: TransportId, bin: string | null, endpoint: LocalEndpoint | null): Promise<ProbeFinding> {
  if (endpoint) {
    const has = typeof endpoint.token === "string" && endpoint.token.trim() !== "";
    return has
      ? { check: "auth", ok: true, observed: "endpoint token supplied (local server — no Anthropic seat is spent)" }
      : {
          check: "auth",
          ok: false,
          observed: "no endpoint token",
          required: "a non-empty token on the endpoint",
          remedy: "Set any non-empty token on the arm's endpoint — a local server ignores its value but rejects its absence.",
        };
  }
  if (transport === "claude" && bin) {
    const out = await runBin(bin, ["auth", "status"]);
    const o = rec(safeJson(out.stdout));
    if (o?.loggedIn === true) {
      const how = [o.authMethod, o.subscriptionType].filter((s): s is string => typeof s === "string").join(" · ");
      return { check: "auth", ok: true, observed: how || "logged in" };
    }
    return {
      check: "auth",
      ok: false,
      observed: out.code === 0 ? (out.stdout.trim().slice(0, 200) || "not logged in") : `exit ${out.code}`,
      required: "`claude auth status` to report loggedIn",
      remedy: "Run `claude auth login` as the user this deployment runs as.",
    };
  }
  return {
    check: "auth",
    ok: false,
    observed: `no zero-token authentication check is known for the "${transport}" transport`,
    required: "a zero-token proof of authorization",
    remedy: `Arm "${transport}" against a local endpoint, whose token the probe can check without spending anything.`,
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw.trim());
  } catch {
    return null;
  }
}

/** The loaded context of a resident model, from `/api/ps`. Null when it is not resident. */
async function residentContext(root: string, model: string): Promise<number | null> {
  const ps = await getJson(`${root}/api/ps`);
  for (const m of list(ps, "models")) {
    const name = typeof m.model === "string" ? m.model : typeof m.name === "string" ? m.name : null;
    if (name && sameModel(name, model)) {
      const n = m.context_length;
      if (typeof n === "number" && Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** All four endpoint-side checks. The order is the order a failure should be read in. */
async function checkEndpoint(endpoint: LocalEndpoint): Promise<{ findings: ProbeFinding[]; serverVersion: string | null }> {
  const root = serverRoot(endpoint.baseUrl);
  const ver = rec(await getJson(`${root}/api/version`));
  const serverVersion = typeof ver?.version === "string" ? ver.version : null;
  if (!ver) {
    return {
      serverVersion: null,
      findings: [
        {
          check: "endpoint",
          ok: false,
          observed: `no answer from ${root}`,
          required: "the inference server to answer /api/version",
          remedy: `Start the inference server, or correct the arm's endpoint (currently ${endpoint.baseUrl}).`,
        },
      ],
    };
  }
  const findings: ProbeFinding[] = [{ check: "endpoint", ok: true, observed: root }];

  const tags = list(await getJson(`${root}/api/tags`), "models");
  const names = tags
    .map((m) => (typeof m.model === "string" ? m.model : typeof m.name === "string" ? m.name : null))
    .filter((s): s is string => s !== null);
  const present = names.some((n) => sameModel(n, endpoint.model));
  findings.push(
    present
      ? { check: "model", ok: true, observed: endpoint.model }
      : {
          check: "model",
          ok: false,
          observed: names.length ? `${names.length} model(s), none matching` : "the server has no models",
          required: `${endpoint.model} to be present on the server`,
          remedy: `Pull it: \`ollama pull ${endpoint.model}\`.`,
        },
  );

  findings.push(present ? await checkContext(root, endpoint) : {
    check: "context",
    ok: false,
    observed: null,
    required: `at least ${MIN_CONTEXT_TOKENS} tokens`,
    remedy: "The model is not on the server, so its running context could not be established.",
  });

  findings.push(
    versionAtLeast(serverVersion, MIN_SERVER_VERSION)
      ? { check: "server-version", ok: true, observed: serverVersion }
      : {
          check: "server-version",
          ok: false,
          observed: serverVersion ?? "unknown",
          required: `at least ${MIN_SERVER_VERSION}`,
          remedy: `Upgrade the inference server to ${MIN_SERVER_VERSION} or later — below it the client's token countdown sits at the front of every prompt and invalidates the key-value cache, so each turn re-prefills the whole context and the arm merely looks slow.`,
        },
  );
  return { findings, serverVersion };
}

/**
 * What context THIS run will get — the loaded one, never the architectural maximum.
 *
 * `/api/show` and `/api/tags` both report a `context_length`, and both report the model's maximum: on
 * this machine qwen2.5:7b answers 32768 there whether the server is serving 4096 or 32768. `/api/ps`
 * answers for the loaded instance, which is the number the run is actually handed, so when the two
 * disagree the loaded one wins and the maximum is not consulted at all.
 */
async function checkContext(root: string, endpoint: LocalEndpoint): Promise<ProbeFinding> {
  let ctx = await residentContext(root, endpoint.model);
  if (ctx == null) {
    // THE ZERO-TOKEN LOAD: `/api/generate` with a model and no prompt returns
    // `{"done_reason":"load"}` having generated nothing. It makes the model resident so `/api/ps` can
    // answer, and it is the same load the run itself is about to pay for.
    await postJson(`${root}/api/generate`, { model: endpoint.model }, LOAD_TIMEOUT_MS);
    ctx = await residentContext(root, endpoint.model);
  }
  if (ctx == null) {
    return {
      check: "context",
      ok: false,
      observed: "the server did not report a loaded context",
      required: `at least ${MIN_CONTEXT_TOKENS} tokens`,
      remedy: `Set the server's context explicitly (OLLAMA_CONTEXT_LENGTH=${MIN_CONTEXT_TOKENS}) and restart it — the model's advertised maximum is not what a run is served, so it is not accepted as evidence here.`,
    };
  }
  if (ctx < MIN_CONTEXT_TOKENS) {
    return {
      check: "context",
      ok: false,
      observed: `${ctx} tokens`,
      required: `at least ${MIN_CONTEXT_TOKENS} tokens`,
      remedy: `Restart the inference server with OLLAMA_CONTEXT_LENGTH=${MIN_CONTEXT_TOKENS} (and unload the model so it reloads at that size) — at ${ctx} tokens the tool definitions are truncated and the model appears unable to call tools at all.`,
    };
  }
  return { check: "context", ok: true, observed: `${ctx} tokens (loaded)`, required: `at least ${MIN_CONTEXT_TOKENS} tokens` };
}

// ── THE PROBE ────────────────────────────────────────────────────────────────────────────────────

/** Probe one transport, optionally against a local endpoint. Never throws: an unreachable server is a
 *  finding, not an exception. */
export async function probeTransport(transport: TransportId, endpoint?: LocalEndpoint | null): Promise<ProbeResult> {
  const at = new Date().toISOString();
  const bin = await checkBinary(transport);
  const findings: ProbeFinding[] = [bin.finding];
  let serverVersion: string | null = null;
  if (endpoint) {
    const server = await checkEndpoint(endpoint);
    findings.push(...server.findings);
    serverVersion = server.serverVersion;
  }
  findings.push(await checkAuth(transport, bin.bin, endpoint ?? null));
  return {
    transport,
    ok: findings.every((f) => f.ok),
    binVersion: bin.version,
    serverVersion,
    findings,
    at,
    // Every check above is a version print, an HTTP read or a load call that generates nothing. No
    // completion request is made on any path, so the probe's token cost is zero by construction —
    // `probe.zero-token.test.ts` holds it there.
    zeroToken: true,
  };
}

/** The one sentence an arming refusal shows, naming the specific failure and its remedy. Null when
 *  the probe passed. */
export function probeRefusal(result: ProbeResult): string | null {
  if (result.ok) return null;
  const miss = result.findings.find((f) => !f.ok);
  if (!miss) {
    // `ok: false` with every finding green is a contradiction; refuse anyway rather than arm on a
    // result nobody can explain.
    return `Refusing to arm the ${result.transport} arm: the preflight probe failed without naming a check.`;
  }
  const detail = [miss.observed ? `observed ${miss.observed}` : null, miss.required ? `required ${miss.required}` : null]
    .filter((s): s is string => s !== null)
    .join(", ");
  const head = `Refusing to arm the ${result.transport} arm: its ${miss.check} check failed${detail ? ` (${detail})` : ""}.`;
  return miss.remedy ? `${head} ${miss.remedy}` : head;
}

export function serializeProbe(result: ProbeResult): string {
  return JSON.stringify(result);
}

/**
 * Read a `probeJson` column back.
 *
 * Null on anything that is not a probe result — never a fabricated pass, because "was this run
 * preflighted?" is exactly the question such a row cannot answer.
 */
export function parseProbe(json: string | null | undefined): ProbeResult | null {
  if (!json) return null;
  const o = rec(safeJson(json));
  if (!o || typeof o.transport !== "string" || typeof o.at !== "string") return null;
  const findings = Array.isArray(o.findings)
    ? o.findings
        .map(rec)
        .filter((f): f is Record<string, unknown> => f !== null && typeof f.check === "string" && typeof f.ok === "boolean")
        .map((f) => ({
          check: f.check as ProbeFinding["check"],
          ok: f.ok as boolean,
          ...(f.observed !== undefined ? { observed: (f.observed as string | null) ?? null } : {}),
          ...(f.required !== undefined ? { required: (f.required as string | null) ?? null } : {}),
          ...(f.remedy !== undefined ? { remedy: (f.remedy as string | null) ?? null } : {}),
        }))
    : [];
  return {
    transport: o.transport as TransportId,
    ok: o.ok === true,
    ...(o.binVersion !== undefined ? { binVersion: (o.binVersion as string | null) ?? null } : {}),
    ...(o.serverVersion !== undefined ? { serverVersion: (o.serverVersion as string | null) ?? null } : {}),
    findings,
    at: o.at,
    zeroToken: o.zeroToken === true,
  };
}
