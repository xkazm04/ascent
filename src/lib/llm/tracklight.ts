// LightTrack (tracklight) telemetry — fire-and-forget LLM-call tracking.
//
// Every real provider.assess() call in the scan pipeline is mirrored to a locally-running
// LightTrack instance (a self-hosted LLM observability + cost tool — see ../../../tracklight)
// via POST /v1/events. This is the single, purpose-built tracker for that contract; it is
// intentionally zero-dependency (global fetch) and best-effort:
//
//   - NEVER throws into the caller and NEVER blocks (the POST is detached, with a short timeout).
//   - DISABLED unless the operator opts in — no LIGHTTRACK_PROJECT / LIGHTTRACK_KEY (and no
//     LIGHTTRACK_ENABLED=1) means zero behavior change and zero network traffic. So production
//     builds that don't set these envs are completely untouched.
//
// Config (read at CALL time, mirroring src/lib/llm/config.ts, so tests can stub env with no
// module-load ordering games):
//   LIGHTTRACK_URL      base URL of the API      (default http://127.0.0.1:8787)
//   LIGHTTRACK_PROJECT  project id (dev mode: sent in the body; a project key overrides it)
//   LIGHTTRACK_KEY      Bearer key               (optional; enforced-auth or a scoped project key)
//   LIGHTTRACK_ENABLED  1|true|0|false           (explicit override of the auto-enable heuristic)
//
// Future (see the tracklight repo): the same event contract points at a CLOUD instance for
// production traffic, and its Claude-Code relay engine runs offline LLM tasks on this device.

import type { ProviderName, TokenUsage } from "@/lib/types";

const DEFAULT_URL = "http://127.0.0.1:8787";
/** The POST is detached; this bounds how long the abort timer keeps the request alive. */
const POST_TIMEOUT_MS = 2000;
/** Cap the error message we forward so a hostile/verbose provider error can't bloat the event. */
const MAX_ERR_LEN = 500;

interface TracklightConfig {
  enabled: boolean;
  url: string;
  project?: string;
  key?: string;
}

/** One LLM call as the scan pipeline sees it — the input to {@link trackLlmCall}. */
export interface LlmCallTrack {
  /** Ascent provider name (mapped to tracklight's provider vocabulary below). */
  provider: ProviderName;
  /** Ascent model id (normalized to the price-book form for Bedrock/Claude). */
  model: string;
  /** Token usage the provider reported (may be empty on a failed/aborted call). */
  usage?: TokenUsage;
  latencyMs?: number;
  status?: "success" | "error" | "timeout";
  error?: string;
  /** owner/repo the scan ran against — carried as event metadata for per-repo rollups. */
  repo?: string;
  /** Org slug (or "public") — carried as event metadata. */
  org?: string | null;
  /** The scan degraded to the deterministic floor — tagged so degradation rate is observable. */
  degraded?: boolean;
  operation?: string;
  /**
   * Which seam issued the call — the BASE tag on the event. Defaults to "scan" so every existing
   * caller is byte-identical. The free-form text seam (src/lib/llm/text.ts, used by Shared Org Memory)
   * issues real, billed model calls that are not scans; tagging them "scan" would quietly inflate
   * scan cost/latency rollups with traffic from a different surface.
   */
  surface?: string;
  tags?: string[];
}

function truthy(v: string | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}
function falsy(v: string | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "0" || s === "false" || s === "no" || s === "off";
}

/** Resolve tracking config from env at call time. Auto-enabled once a project/key is configured
 *  (the operator has opted in), unless LIGHTTRACK_ENABLED explicitly forces it on/off. */
export function tracklightConfig(): TracklightConfig {
  const project = process.env.LIGHTTRACK_PROJECT?.trim() || undefined;
  const key = process.env.LIGHTTRACK_KEY?.trim() || undefined;
  const explicit = process.env.LIGHTTRACK_ENABLED;
  const enabled = falsy(explicit)
    ? false
    : truthy(explicit) || Boolean(project) || Boolean(key);
  const url = (process.env.LIGHTTRACK_URL || DEFAULT_URL).replace(/\/+$/, "");
  return { enabled, url, project, key };
}

/**
 * Ascent provider name → tracklight's normalized provider vocabulary (openai | anthropic | google |
 * mock). Cost is keyed "<provider>/<model>", so this must line up with {@link toTracklightModel}.
 *
 * Typed as a FULL Record over ProviderName (not a switch with a `default: return name`) so adding a
 * member to the union FAILS THE COMPILE here instead of silently emitting events under a provider
 * key the price book has never heard of — the same discipline PROVIDER_LABEL applies in config.ts,
 * and exactly the gap that let `openrouter` fall through the old default for as long as it existed.
 */
const TRACKLIGHT_PROVIDER: Record<ProviderName, string> = {
  gemini: "google",
  bedrock: "anthropic",
  "claude-cli": "anthropic",
  openai: "openai",
  // OpenRouter is a PROXY, not a vendor — the real provider is resolved per-model below, and this is
  // only the fallback for a slug whose vendor tracklight doesn't price.
  openrouter: "openrouter",
  // A local Ollama / vLLM / LM Studio server. Keyed as "local" rather than "openai" (whose wire
  // protocol it borrows) so tracklight's cost book never prices self-hosted GPU tokens at a vendor's
  // API rate — the same reasoning as isZeroCostProvider in config.ts.
  local: "local",
  mock: "mock",
};

/**
 * OpenRouter model slugs are always `vendor/model`. When the vendor is one tracklight prices, key the
 * event under THAT vendor and strip the prefix off the model — so an OpenRouter-routed Sonnet lands
 * on the SAME price-book row as a Bedrock Sonnet. That is the whole point of the fleet path (compare
 * models on cost/quality), and it is impossible if every OpenRouter call is priced as "unknown".
 * A vendor we don't price stays under "openrouter" carrying the FULL slug as the model, so the call
 * is still identifiable (and obviously unpriced) rather than mis-attributed.
 */
const OPENROUTER_VENDOR: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
};

/** The tracklight vendor an OpenRouter `vendor/model` slug routes to, or undefined when unpriced. */
function openrouterVendor(model: string | undefined): string | undefined {
  const prefix = (model ?? "").trim().toLowerCase().split("/")[0];
  return prefix ? OPENROUTER_VENDOR[prefix] : undefined;
}

/** Map an ascent provider name (+ model, needed to resolve an OpenRouter proxy hop) to tracklight's
 *  normalized provider vocabulary. */
export function toTracklightProvider(name: ProviderName, model?: string): string {
  if (name === "openrouter") return openrouterVendor(model) ?? TRACKLIGHT_PROVIDER.openrouter;
  return TRACKLIGHT_PROVIDER[name];
}

/** Bedrock cross-region inference geo prefixes — routing metadata, not part of the model id. */
const GEO_PREFIX = /^(us|eu|apac|global)\./;
/** claude-cli aliases → canonical model ids that exist in tracklight's price book. */
const CLAUDE_ALIAS: Record<string, string> = {
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
  opus: "claude-opus-4-8",
};

/** Normalize the model id to tracklight's price-book form. Bedrock ids carry a geo prefix and the
 *  `anthropic.` vendor prefix (e.g. `us.anthropic.claude-sonnet-4-6`); tracklight keys are bare
 *  (`claude-sonnet-4-6`). claude-cli uses short aliases (`sonnet`). Other providers pass through. */
export function toTracklightModel(name: ProviderName, model: string): string {
  const m = model.trim();
  if (name === "bedrock") {
    return m.toLowerCase().replace(GEO_PREFIX, "").replace(/^anthropic\./, "");
  }
  if (name === "claude-cli") {
    return CLAUDE_ALIAS[m.toLowerCase()] ?? m;
  }
  if (name === "openrouter") {
    // Strip the `vendor/` prefix ONLY when toTracklightProvider keyed the event under that vendor —
    // the two must agree or the "<provider>/<model>" cost key is a chimera.
    const lower = m.toLowerCase();
    return openrouterVendor(lower) ? lower.slice(lower.indexOf("/") + 1) : m;
  }
  return m;
}

/** Build the tracklight /v1/events body for a tracked call. Exported for unit testing. */
export function buildEventBody(ev: LlmCallTrack, project?: string): Record<string, unknown> {
  const usage: Record<string, number> = {
    input: Math.trunc(ev.usage?.inputTokens ?? 0),
    output: Math.trunc(ev.usage?.outputTokens ?? 0),
  };
  // Bedrock surfaces a prompt-cache breakdown; the cache-READ class is what tracklight prices at
  // the cached rate. (Cache WRITES have no distinct field in the event contract.)
  if (ev.usage?.cacheReadTokens != null) usage.cached_input = Math.trunc(ev.usage.cacheReadTokens);

  const body: Record<string, unknown> = {
    provider: toTracklightProvider(ev.provider, ev.model),
    model: toTracklightModel(ev.provider, ev.model) || "unknown",
    usage,
    source: "ascent",
    operation: ev.operation ?? "chat",
  };
  if (project) body.project_id = project;
  if (ev.latencyMs != null) body.latency_ms = Math.trunc(ev.latencyMs);

  let status = ev.status;
  if (ev.error) {
    body.error = ev.error.slice(0, MAX_ERR_LEN);
    status = status ?? "error";
  }
  if (status) body.status = status;

  body.tags = [ev.surface ?? "scan", ...(ev.degraded ? ["degraded"] : []), ...(ev.tags ?? [])];

  const metadata: Record<string, unknown> = {};
  if (ev.repo) metadata.repo = ev.repo;
  if (ev.org) metadata.org = ev.org;
  if (ev.degraded != null) metadata.degraded = ev.degraded;
  if (Object.keys(metadata).length) body.metadata = metadata;

  return body;
}

/**
 * Record one LLM call to LightTrack. Returns immediately; the send is detached and best-effort —
 * it never throws and never blocks the scan. A no-op when tracking is not configured.
 */
export function trackLlmCall(ev: LlmCallTrack): void {
  const cfg = tracklightConfig();
  if (!cfg.enabled) return;
  post(cfg, "/v1/events", buildEventBody(ev, cfg.project));
}

function post(cfg: TracklightConfig, path: string, body: Record<string, unknown>): void {
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cfg.key) headers.authorization = `Bearer ${cfg.key}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), POST_TIMEOUT_MS);
    void fetch(`${cfg.url}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ac.signal,
      cache: "no-store",
    })
      .catch(() => undefined) // best-effort: telemetry must never surface into the host app
      .finally(() => clearTimeout(timer));
  } catch {
    // Synchronous failure (e.g. JSON.stringify on a circular metadata value) must also be swallowed.
  }
}
