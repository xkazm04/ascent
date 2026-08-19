import { resolveProviderChoice, hasLlmKey } from "@/lib/llm";
import { localLlmConfigured } from "@/lib/llm/local";
import { MAX_FILES } from "@/lib/github/source";
import type { ProviderName } from "@/lib/types";

// Resolve the EFFECTIVE inference provider the same way getProvider() does, so the disclosure
// matches what a real scan will actually use: "auto"/"gemini" degrade to mock without a key, and an
// explicitly-selected real provider is shown as-is (it fails fast → mock only if mis-wired at scan time).
function effectiveProvider(): ProviderName {
  const choice = resolveProviderChoice();
  if (choice === "gemini") return hasLlmKey() ? "gemini" : "mock";
  // Mirrors autoProvider()'s ladder in src/lib/llm/index.ts: Gemini key, else a configured local
  // server, else mock. A self-hoster running Ollama was previously told their code goes "nowhere:
  // scoring is fully local and deterministic" — accidentally true about the destination, but it named
  // the wrong reason (mock, i.e. no AI at all) at the exact screen where the reason is the point.
  if (choice === "auto") return hasLlmKey() ? "gemini" : localLlmConfigured() ? "local" : "mock";
  return choice;
}

// Where a private scan's sampled file contents actually go, per provider — accurate, no overclaiming.
// Only Bedrock carries the documented no-training / in-boundary guarantee (see docs/features/scanning/llm-providers.md).
const WHERE: Record<ProviderName, string> = {
  bedrock:
    "Claude on AWS Bedrock: your code stays within the AWS boundary and is never used for model training.",
  "claude-cli": "a local Claude CLI under your own subscription: your code stays on this machine.",
  gemini: "the Google Gemini API to produce the score.",
  openai: "your configured OpenAI-compatible endpoint to produce the score.",
  openrouter: "the OpenRouter API, which routes the request to your selected model's upstream provider.",
  local: "your own LLM server at LOCAL_LLM_BASE_URL: no code leaves the machines you run.",
  mock: "nowhere: scoring is fully local and deterministic; no code leaves this deployment.",
};

/**
 * Privacy disclosure shown at the private-scan decision point (/connect): WHERE a repo's code goes
 * during inference, and the Bedrock no-training / in-your-cloud option for sensitive code. The connect
 * header already covers persistence ("only scores + evidence, never your source"); this covers the
 * inference hop the header was silent about — surfaced in-product, not buried in docs.
 */
export function ConnectPrivacyNotice() {
  const provider = effectiveProvider();
  const isBedrock = provider === "bedrock";
  const isMock = provider === "mock";
  // Inference that never leaves hardware the operator controls: a local OpenAI-compatible server, or
  // the `claude` CLI running on this machine. Both are a STRONGER privacy position than Bedrock, so
  // they must not be shown the "upgrade to Bedrock for an in-your-cloud guarantee" nudge below — that
  // would be advising a self-hoster to send their source to a third party for privacy reasons.
  const staysOnPremises = provider === "local" || provider === "claude-cli";
  return (
    <section className="mt-5 rounded-xl border border-divider bg-surface/40 p-4 text-sm text-slate-300">
      <div className="font-mono text-xs uppercase tracking-[0.25em] text-accent">Where your code goes</div>
      <p className="mt-2">
        During a private scan, a budgeted sample of your repository&apos;s file contents (≤{MAX_FILES} files,
        plus CI workflow files) is sent to{" "}
        {WHERE[provider]} Ascent persists only the derived scores and evidence, never your source.
      </p>
      {isBedrock && (
        <p className="mt-2 text-emerald-300">
          ✓ This deployment routes inference through AWS Bedrock, the enterprise-privacy path.
        </p>
      )}
      {staysOnPremises && (
        <p className="mt-2 text-emerald-300">
          ✓ Inference runs on hardware you control. Your source never reaches a third-party API.
        </p>
      )}
      {!isBedrock && !isMock && !staysOnPremises && (
        <p className="mt-2 text-slate-400">
          Need a no-training, in-your-cloud guarantee for sensitive code? Route inference through{" "}
          <span className="font-mono text-slate-300">AWS Bedrock</span> (
          <span className="font-mono text-slate-300">LLM_PROVIDER=bedrock</span>). Code stays within your
          AWS boundary and is never used for model training.
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Active inference provider: <span className="font-mono text-slate-300">{provider}</span>
      </p>
    </section>
  );
}
