// The agent-CLI transport contract — the seam behind which a locally-installed coding-agent CLI
// (claude, codex, …) is treated as a headless model transport: prompt in over stdin, one child
// process per call, one normalized result out. This is the reference implementation of the
// registry subject `software-engineering/llm-agent/runtime-and-io/agent-cli-transport`.
//
// NOT to be confused with src/lib/llm/transports.ts (no trailing "…/"), which is the Athena text
// seam's HTTP wire formats (OpenAI-compatible / Gemini / Bedrock request shapes). That module talks
// to chat APIs over fetch; this one spawns subscription-billed CLI binaries.
//
// The mode is the caller's TYPED choice and it never folds (subject golden path): `generate` runs in
// a neutral tmpdir so the tool loads no ambient project instructions and can touch no workspace;
// `readonly-scan` may read the given cwd but provably not write it; `edit` works inside a workspace
// and is expected to change it. These stay separate seams at the CONSUMER level too —
// src/lib/llm/claude-cli.ts (assessment) and src/lib/local/agent.ts (autopilot edit) keep their
// separate exported functions and separate gating (cliProviderAllowed vs autopilotEnabled) on
// purpose; folding them into one parameterized call site "would make 'which mode am I in?' a bug
// that type-checks" (agent.ts header). The transport only carries the vocabulary.

export type TransportMode = "generate" | "readonly-scan" | "edit";

/** Result of a zero-token availability probe: installed? at what version? authorized to answer? */
export interface TransportProbe {
  /** The binary exists and answered `--version`. */
  available: boolean;
  /** The tool reports a live login/session — proven WITHOUT spending tokens. */
  authed: boolean;
  /** Version string as reported (suffixes/prefixes stripped leniently). */
  version?: string;
  /** Bounded diagnostic when unavailable/unauthed (the raw text IS the diagnosis). */
  detail?: string;
}

export interface TransportRunArgs {
  /** Travels over the child's stdin, never the argument vector (prompts contain quotes/newlines). */
  prompt: string;
  mode: TransportMode;
  /** Workspace for readonly-scan/edit. Ignored by `generate`, which always uses a neutral tmpdir. */
  cwd?: string;
  /** JSON Schema to constrain the final answer. See TransportCapabilities.schemaWired before use. */
  schema?: object;
  /** Model id/alias; validated as a plain token before it reaches the shell:true spawn. */
  model?: string;
  /** App-enforced wall clock (no tool in this class has a timeout flag). Floored at 1s — a tiny
   *  value is misconfiguration, not "no timeout" (same rationale as MIN_LLM_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Client disconnect — kills the child so an abandoned call doesn't bill to completion. */
  signal?: AbortSignal;
}

/** Typed failure classification. `subtype` carries the TOOL's own error classification when the
 *  envelope had one; `cause` preserves the original thrown value (spawn ENOENT, abort reason) so a
 *  wrapper that must rethrow can surface the identical object. */
export interface TransportError {
  kind:
    | "not-supported" // this adapter does not implement the requested mode/capability
    | "config" //        invalid model token, missing cwd for a workspace mode, …
    | "spawn" //         the child could not be started (missing binary, broken pipe)
    | "timeout"
    | "aborted"
    | "output-cap" //    the runaway-output byte cap killed the child
    | "exit" //          nonzero exit without a usable envelope
    | "envelope"; //     output arrived but was not a parseable/successful envelope
  message: string;
  /** The tool's own error classification (e.g. the claude envelope's `subtype`). */
  subtype?: string;
  cause?: unknown;
}

export interface TransportRunResult {
  ok: boolean;
  /** The normalized final answer text (the envelope's answer field / last agent message). */
  text?: string;
  /** Parsed JSON answer, only when a schema-constrained run produced parseable JSON. */
  json?: unknown;
  /** The tool's full raw stdout capture, kept so metering and diagnosis never depend on the
   *  normalized view. Empty string when the child produced nothing. */
  raw: string;
  durationMs: number;
  error?: TransportError;
}

/**
 * Dated capability descriptor — capability answers are data verified on a date, never baked
 * constants (these tools ship weekly). A consumer that needs a capability checks the row and
 * degrades/hides when it is absent or stale, rather than assuming.
 */
export interface TransportCapabilities {
  /** ISO date the rows below were last verified against a live binary on a real machine. */
  verifiedOn: string;
  /** The version the verification ran against. */
  verifiedVersion: string;
  /** Modes this adapter actually implements today (a mode outside this list returns a typed
   *  `not-supported` error, never a silent downgrade). */
  modes: TransportMode[];
  /** How the tool's answer arrives — which envelope dialect the adapter normalizes. */
  answerChannel: "single-json" | "jsonl-events" | "answer-file";
  /** Native schema-constrained output support in the TOOL (inline flag / schema file / none)… */
  schemaOutput: "inline-flag" | "schema-file" | "none";
  /** …and whether THIS adapter has wired it through the spawn door yet. */
  schemaWired: boolean;
  /** What backs the readonly-scan promise: an OS sandbox, tool policy, or nothing (unsupported). */
  readonlyEnforcement: "os-sandbox" | "policy" | "unsupported";
  /** Whose bill a run lands on, and the env vars the spawn door strips (direction "strip") or
   *  requires (direction "inject") to keep it there. */
  billing: { direction: "strip" | "inject"; envVars: string[] };
}

export interface AgentCliTransport {
  readonly name: string;
  readonly capabilities: TransportCapabilities;
  /** Zero-token install + auth check. Never throws; absence is a product state, not an exception. */
  probe(): Promise<TransportProbe>;
  /** One call, one child process, one normalized result. Never rejects — failure is a typed
   *  outcome carrying the tool's own classification, not a bare nonzero exit. */
  run(args: TransportRunArgs): Promise<TransportRunResult>;
}
