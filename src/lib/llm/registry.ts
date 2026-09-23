// The PROVIDER REGISTRY: one keyed table that answers every provider question in this codebase.
//
// WHY A TABLE. `ProviderName` is declared once, and was then re-implemented by hand in seven places:
// the accepted-choice list, three switches in index.ts (availability, explicit construction, failover
// construction), the auto ladder (twice more, in text.ts and PrivacyNotice), the text seam's own
// switch, and the BYOM kind mapping (twice). Every provider added since the text seam existed landed
// in some of those and not others: `local` once resolved for scans and "no engine" everywhere else,
// and `nebius` still did — Athena, the memory passes, lane summaries and the briefing narrative all
// reported "no engine" under LLM_PROVIDER=nebius while its scans ran fine. On the request path the
// members are interchangeable, so dispatch belongs to one table, not to N switches that must each
// remember every member.
//
// `REGISTRY` is a TOTAL Record over ProviderName: an 11th union member without a descriptor fails
// `tsc`, and the parity contract in registry.test.ts fails if its two seams disagree.
//
// What stays OUT on purpose: PROVIDER_LABEL / ENGINE_LABEL (already compiler-total Records) and the
// base-URL / attribution-header constants (a separately filed item).

import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import type { LlmAssessment, ProviderName } from "@/lib/types";
import type { ResolvedLegRunner, TextRunnerOptions } from "@/lib/llm/leg";
// TYPE-ONLY: text.ts imports this module at runtime, so a value import back would close a cycle.
import type { LegConnection } from "@/lib/llm/text";
import type { ByomProviderParams } from "@/lib/db/org-llm";
import { DEFAULT_GEMINI_MODEL, GeminiProvider } from "@/lib/llm/gemini";
import { BedrockProvider, DEFAULT_BEDROCK_MODEL, DEFAULT_BEDROCK_REGION, type BedrockCredentials } from "@/lib/llm/bedrock";
import { DEFAULT_OPENAI_MODEL, OpenAiProvider } from "@/lib/llm/openai";
import { DEFAULT_OPENROUTER_MODEL, OpenRouterProvider } from "@/lib/llm/openrouter";
import { GatewayProvider } from "@/lib/llm/gateway";
import { MockProvider } from "@/lib/llm/mock";
import { LocalProvider, localLlmConfigured } from "@/lib/llm/local";
import { NEBIUS_DEFAULT_BASE_URL, NebiusProvider, nebiusConfigured } from "@/lib/llm/nebius";
import { cliProviderAllowed, llmTimeoutMs } from "@/lib/llm/config";

/**
 * How a provider serves the free-form text seam (text.ts):
 *   - `connection` — a hosted/HTTP endpoint; text.ts binds it to its wire transport (legCallFor);
 *   - `runner`     — a transport that owns its own process and timeout (claude-cli);
 *   - `none`       — DECLARED absent, with the reason, so "no engine" is a stated fact, not a miss.
 */
export type TextSeam =
  | { none: string }
  | { connection(): LegConnection }
  | { runner(opts: TextRunnerOptions): Promise<ResolvedLegRunner | null> };

export interface ProviderDescriptor {
  /** Cheap, synchronous env check: is this provider's prerequisite present here? Gates the failover
   *  and the text seam; an EXPLICIT scan selection is trusted regardless (see getProvider). */
  available(): boolean;
  /** Construct the scan-seam provider. Side-effect-free: no network until assess(). */
  scan(): LLMProvider;
  /** Position on the `auto` ladder (lower is tried first). Absent = explicit-only: `auto` never
   *  selects it, even when it is available (the CLIs, the gateway, and every paid hosted API). */
  autoRung?: number;
  textSeam: TextSeam;
}

/** GEMINI_API_KEY, or its GOOGLE_API_KEY alias, or "" — the one place that alias is spelled. */
export function geminiApiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const noTrailingSlash = (url: string) => url.replace(/\/$/, "");

/**
 * Lazy proxy for the claude-cli provider. It shells out via child_process to a local `claude` binary.
 * The dynamic import defers loading claude-cli.ts until a scan actually runs under it; `name`/`model`
 * resolve synchronously so the scan pipeline can read them before the (lazy) assess().
 * The descriptor's `available` gates on the same {@link cliProviderAllowed} predicate, so the failover
 * skips this provider rather than selecting a guaranteed-throw one.
 */
class LazyClaudeCliProvider implements LLMProvider {
  readonly name = "claude-cli" as const;
  readonly model: string;
  constructor(model?: string) {
    // The real default lives in claude-cli.ts (DEFAULT_CLAUDE_MODEL = "sonnet"); mirror it here rather
    // than import it, which would re-introduce the static dependency this proxy exists to avoid.
    this.model = model || process.env.CLAUDE_MODEL || "sonnet";
  }
  async assess(input: LlmScoreInput, opts?: AssessOptions): Promise<LlmAssessment> {
    if (cliProviderAllowed()) {
      const { ClaudeCliProvider } = await import("@/lib/llm/claude-cli");
      return new ClaudeCliProvider(this.model).assess(input, opts);
    }
    // Managed cloud: no `claude` binary on the host, so refuse rather than hang for the CLI timeout.
    throw new Error(
      "claude-cli needs a local `claude` binary and is not available on this managed deployment. " +
        "Set ASCENT_SELF_HOSTED=1 if you are running Ascent on your own machine, or choose another " +
        "LLM_PROVIDER.",
    );
  }
}

/**
 * Lazy proxy for the codex-cli provider — the exact shape of {@link LazyClaudeCliProvider}, for the
 * same reason, gated on the SAME cliProviderAllowed() predicate.
 */
class LazyCodexCliProvider implements LLMProvider {
  readonly name = "codex-cli" as const;
  readonly model: string;
  constructor(model?: string) {
    // Mirror DEFAULT_CODEX_MODEL in codex-cli.ts ("codex-default" — the CLI's own configured
    // default, an id we can't know without a probe) rather than import it.
    this.model = model || process.env.CODEX_MODEL || "codex-default";
  }
  async assess(input: LlmScoreInput, opts?: AssessOptions): Promise<LlmAssessment> {
    if (cliProviderAllowed()) {
      const { CodexCliProvider } = await import("@/lib/llm/codex-cli");
      return new CodexCliProvider(this.model).assess(input, opts);
    }
    throw new Error(
      "codex-cli needs a local `codex` binary and is not available on this managed deployment. " +
        "Set ASCENT_SELF_HOSTED=1 if you are running Ascent on your own machine, or choose another " +
        "LLM_PROVIDER.",
    );
  }
}

/** Any sign the host is wired for AWS. BedrockProvider ALWAYS resolves a region (BEDROCK_REGION >
 *  AWS_REGION > us-east-1), so region is never a hard prerequisite; checking only AWS_REGION
 *  false-negatived correctly-configured deploys (BEDROCK_REGION-only, key-only) into a silent mock. */
function awsConfigured(): boolean {
  return Boolean(
    process.env.BEDROCK_REGION ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_PROFILE ||
      process.env.AWS_ROLE_ARN ||
      process.env.AWS_WEB_IDENTITY_TOKEN_FILE ||
      process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI,
  );
}

export const REGISTRY: Record<ProviderName, ProviderDescriptor> = {
  gemini: {
    autoRung: 0,
    available: () => Boolean(geminiApiKey()),
    // Keyless on an EXPLICIT selection is deliberate: it fails LOUD at assess() and degrades through
    // the accounted retry → failover → mock chain instead of serving the floor as if it were real.
    scan: () => new GeminiProvider(geminiApiKey()),
    textSeam: {
      connection: () => ({
        engine: "gemini",
        model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
        apiKey: geminiApiKey(),
      }),
    },
  },
  bedrock: {
    available: awsConfigured,
    scan: () => new BedrockProvider(),
    textSeam: {
      connection: () => ({
        engine: "bedrock",
        model: process.env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL,
        region: process.env.BEDROCK_REGION || process.env.AWS_REGION || DEFAULT_BEDROCK_REGION,
      }),
    },
  },
  openai: {
    available: () => Boolean(process.env.OPENAI_API_KEY),
    scan: () => new OpenAiProvider(),
    textSeam: {
      connection: () => ({
        engine: "openai",
        model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
        baseUrl: noTrailingSlash(process.env.OPENAI_BASE_URL || OPENAI_DEFAULT_BASE_URL),
        apiKey: process.env.OPENAI_API_KEY ?? "",
      }),
    },
  },
  openrouter: {
    available: () => Boolean(process.env.OPENROUTER_API_KEY),
    scan: () => new OpenRouterProvider(),
    textSeam: {
      connection: () => ({
        engine: "openrouter",
        model: process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
        apiKey: process.env.OPENROUTER_API_KEY ?? "",
      }),
    },
  },
  local: {
    // Config-driven, not probe-driven: getProvider() is synchronous and on the scan hot path, so it
    // cannot sniff for a listening Ollama. BOTH knobs, matching LocalProvider's own guard.
    autoRung: 1,
    available: localLlmConfigured,
    scan: () => new LocalProvider(),
    textSeam: {
      connection: () => ({
        engine: "local",
        model: (process.env.LOCAL_LLM_MODEL ?? "").trim(),
        baseUrl: noTrailingSlash((process.env.LOCAL_LLM_BASE_URL ?? "").trim()),
        // Local servers usually ignore auth; a key passes through only when the operator set one.
        apiKey: process.env.LOCAL_LLM_API_KEY ?? "",
      }),
    },
  },
  nebius: {
    // Hosted, billed per token: explicit-only, never an `auto` rung. Both knobs, as NebiusProvider.
    available: nebiusConfigured,
    scan: () => new NebiusProvider(),
    textSeam: {
      connection: () => ({
        engine: "nebius",
        model: (process.env.NEBIUS_MODEL ?? "").trim(),
        baseUrl: noTrailingSlash((process.env.NEBIUS_BASE_URL || NEBIUS_DEFAULT_BASE_URL).trim()),
        apiKey: process.env.NEBIUS_API_KEY ?? "",
      }),
    },
  },
  mock: {
    available: () => true,
    scan: () => new MockProvider(),
    textSeam: {
      none:
        "there is no honest deterministic text for a caller whose whole job is judgment; " +
        '"no engine" is the truthful answer',
    },
  },
  "claude-cli": {
    // Both CLIs share one gate: "is a local agent CLI usable on this deployment?" — the same predicate
    // the lazy provider's assess() refuses on, so availability and refusal can never disagree.
    available: cliProviderAllowed,
    scan: () => new LazyClaudeCliProvider(),
    textSeam: {
      async runner(opts) {
        // The dynamic import lives INSIDE a `NODE_ENV !== "production"` block, not after a guard
        // `throw`: the production build inlines NODE_ENV, folds this to `false`, and prunes the block —
        // import included — dropping claude-cli.ts and its child_process.spawn from the Node File
        // Trace. Same trick as the PGlite boot (instrumentation.ts). Do not "simplify" it; the shape is
        // pinned by a source guard in registry.test.ts.
        if (process.env.NODE_ENV !== "production") {
          const { runClaudePrompt } = await import("@/lib/llm/claude-cli");
          const model = process.env.CLAUDE_MODEL || "sonnet";
          const timeoutMs = opts.timeoutMs ?? llmTimeoutMs();
          return {
            engine: "claude-cli",
            model,
            // The CLI owns its own timeout (it spawns a process rather than issuing a request), and it
            // cannot be handed tools — `--output-format json` collapses the whole session (see
            // supportsToolCalling in config.ts) — so `req.tools` is ignored and the loop degrades.
            call: async (req, signal) => ({ text: await runClaudePrompt(req.prompt, { signal, timeoutMs }) }),
            ownsTimeout: true,
          };
        }
        return null;
      },
    },
  },
  "codex-cli": {
    available: cliProviderAllowed,
    scan: () => new LazyCodexCliProvider(),
    textSeam: {
      none:
        "the codex CLI serves the assessment seam only; there is no runCodexPrompt counterpart, and " +
        "substituting another provider would route text through one the operator never chose",
    },
  },
  gateway: {
    // A loopback endpoint with no key: nothing to sniff, and a gateway that is not running fails fast
    // (connection refused) inside assess() rather than hanging.
    available: () => true,
    scan: () => new GatewayProvider(),
    textSeam: {
      none:
        "the gateway carries one measured route (`assess`); a text request would run unmeasured under " +
        "the app's seat limits until a route for it is onboarded (docs/LLM_ROUTES.md)",
    },
  },
};

/** Every provider name, in registry order — the list `resolveProviderChoice` accepts (plus `auto`). */
export const PROVIDER_NAMES = Object.keys(REGISTRY) as ProviderName[];

export function isProviderName(value: string): value is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value);
}

/** The `auto` ladder's rungs, derived once from the descriptors' `autoRung`. */
export const AUTO_LADDER: readonly ProviderName[] = PROVIDER_NAMES.filter(
  (n) => REGISTRY[n].autoRung !== undefined,
).sort((a, b) => REGISTRY[a].autoRung! - REGISTRY[b].autoRung!);

/**
 * THE auto ladder — the only one. Gemini with a key, else a fully-configured LOCAL server, else mock.
 * The local rung is what makes a keyless self-hosted install worth running; it sits below Gemini so no
 * existing deployment changes behaviour. Read by the scan seam, the text seam and the privacy notice,
 * so all three name the same provider for the same config.
 */
export function autoProviderName(): ProviderName {
  return AUTO_LADDER.find((n) => REGISTRY[n].available()) ?? "mock";
}

/** The text seam's transports for a BYOM connection, injected by the caller (see byomDescriptor). */
export interface ByomLegBinders {
  openrouter(model: string, apiKey: string): ResolvedLegRunner;
  bedrock(model: string, region: string, credentials?: BedrockCredentials): ResolvedLegRunner;
}

export interface ByomDescriptor {
  name: "openrouter" | "bedrock";
  model: string;
  /** The org's scan provider, on its own credentials. */
  scan(): LLMProvider;
  /** The org's raw text-seam leg. The binders come from text.ts, which imports this module, so they
   *  are handed in rather than imported back — the mapping stays here, the transports stay there. */
  leg(bind: ByomLegBinders): ResolvedLegRunner;
}

/**
 * An org's resolved BYOM params → its provider, for BOTH seams. Bedrock keeps inference in the org's
 * AWS boundary; OpenRouter routes to third-party upstreams on the org's own key. This is the one
 * place that mapping is written (getProviderForOrg and text-org.ts both read it).
 */
export function byomDescriptor(p: ByomProviderParams): ByomDescriptor {
  if (p.kind === "openrouter") {
    return {
      name: "openrouter",
      model: p.model,
      scan: () => new OpenRouterProvider({ model: p.model, apiKey: p.apiKey }),
      leg: (bind) => bind.openrouter(p.model, p.apiKey),
    };
  }
  return {
    name: "bedrock",
    model: p.model,
    // The scan provider resolves an absent region through BEDROCK_REGION/AWS_REGION itself; the text
    // leg takes the default directly. Both behaviours are preserved exactly as they were.
    scan: () => new BedrockProvider({ model: p.model, region: p.region, credentials: p.credentials }),
    leg: (bind) => bind.bedrock(p.model, p.region ?? DEFAULT_BEDROCK_REGION, p.credentials),
  };
}
