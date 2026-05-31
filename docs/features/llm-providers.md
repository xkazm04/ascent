# LLM providers

The scoring step calls an LLM only to **calibrate and explain** deterministic signals —
never to invent scores from scratch. That call goes through a single interface,
`LLMProvider`, so the model behind it is a config change, not a rewrite. This is the seam
that lets the public-repo demo run on Gemini while enterprise private-repo scans route
through AWS Bedrock (code never leaves the AWS boundary, never used for training — see
[ENTERPRISE.md](../ENTERPRISE.md)).

## The interface (`src/lib/llm/provider.ts`)

```ts
interface LLMProvider {
  readonly name: ProviderName;        // "gemini" | "bedrock" | "mock" | "claude-cli"
  readonly model: string;             // e.g. "gemini-3-flash-preview"
  assess(input: LlmScoreInput, opts?: AssessOptions): Promise<LlmAssessment>;
}
```

`LlmScoreInput` carries the `RepoMeta`, the 9 `DimensionSignals`, the sampled
`FetchedFile[]`, a commit sample, and the `archetype`. `LlmAssessment` is the structured
result (per-dimension score/summary/strengths/gaps, headline, strengths, risks, roadmap,
discrepancies). Two helpers guard the boundary:

- `validateAssessment()` — defensively coerces arbitrary JSON into a well-formed
  `LlmAssessment`, filling gaps and clipping arrays.
- `isAssessmentUsable()` — quality gate: requires coverage of ≥ 50% of the requested
  dimensions. `scanRepository` uses it to decide whether to fall back to mock.

## Selection (`src/lib/llm/index.ts:getProvider`)

Chosen at runtime by the `LLM_PROVIDER` env flag:

| `LLM_PROVIDER` | Provider | When |
| --- | --- | --- |
| `auto` (default) | Gemini if a key is present, else mock | Picks Gemini when `GEMINI_API_KEY`/`GOOGLE_API_KEY` is set; **never** silently selects Bedrock. |
| `gemini` | `GeminiProvider` | Local dev & public-repo scanning (fast, cheap, generous free tier). |
| `bedrock` | `BedrockProvider` | Enterprise / private repos — in-account, KMS, VPC, no training on data. Opt-in. |
| `mock` | `MockProvider` | Keyless demo / CI / deterministic tests. |
| `claude-cli` | `ClaudeCliProvider` | Local Claude over stdio (dev). |

## Implementations

| Provider | File | Notes |
| --- | --- | --- |
| Gemini | `src/lib/llm/gemini.ts` | `@google/genai`. Model from `GEMINI_MODEL` (default `gemini-3-flash-preview`), timeout `LLM_TIMEOUT_MS` (default 60s). Constrains decoding with `responseJsonSchema: ASSESSMENT_JSON_SCHEMA`. |
| Bedrock | `src/lib/llm/bedrock.ts` | `@aws-sdk/client-bedrock-runtime`, **lazy-imported** so non-Bedrock paths never pull the SDK. Model `BEDROCK_MODEL_ID` (default `us.anthropic.claude-sonnet-4-6`), region `BEDROCK_REGION`/`AWS_REGION`. Forces JSON via the Converse API's required-tool (function-calling) `inputSchema`. |
| Mock | `src/lib/llm/mock.ts` | Deterministic, no network. Derives the assessment from signal scores and builds a fallback roadmap. The keyless demo + CI floor. |
| Claude CLI | `src/lib/llm/claude-cli.ts` | Talks to a local `claude` binary over stdio. Dev convenience. |

## JSON robustness (`src/lib/llm/json.ts`, `src/lib/llm/schema.ts`)

- `ASSESSMENT_JSON_SCHEMA` (`schema.ts`) is the **single source of truth** for the
  assessment shape, fed to Gemini (`responseJsonSchema`) and Bedrock (Converse tool
  `inputSchema`) so both providers emit conforming JSON up front.
- `parseJsonLoose()` (`json.ts`) is a tolerant parser for everything else: direct parse →
  first fenced ```` ```json ```` block → balanced-brace scan (handles prose wrapping,
  trailing junk, escaped strings). Throws `ProviderParseError` (with a snippet) only when
  all strategies fail.

## Known gaps

- **Bedrock is Phase 2.** The provider exists and works, but the surrounding enterprise
  infra (IAM roles, VPC/PrivateLink, data-residency model overrides) is set up per
  deployment — see [ARCHITECTURE.md](../ARCHITECTURE.md) §3.
- **Gemini ≠ enterprise path.** Google's proprietary Gemini models are not on Bedrock, so
  private code is routed to Claude-on-Bedrock / Nova, not Gemini. The abstraction leaves
  room for a Vertex AI provider if a customer specifically requires Gemini.
