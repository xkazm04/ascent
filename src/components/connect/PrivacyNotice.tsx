import { resolveProviderChoice, hasLlmKey } from "@/lib/llm";
import type { ProviderName } from "@/lib/types";

// Resolve the EFFECTIVE inference provider the same way getProvider() does, so the disclosure
// matches what a real scan will actually use: "auto"/"gemini" degrade to mock without a key, and an
// explicitly-selected real provider is shown as-is (it fails fast → mock only if mis-wired at scan time).
function effectiveProvider(): ProviderName {
  const choice = resolveProviderChoice();
  if (choice === "auto" || choice === "gemini") return hasLlmKey() ? "gemini" : "mock";
  return choice;
}

// Where a private scan's sampled file contents actually go, per provider — accurate, no overclaiming.
// Only Bedrock carries the documented no-training / in-boundary guarantee (see docs/features/llm-providers.md).
const WHERE: Record<ProviderName, string> = {
  bedrock:
    "Claude on AWS Bedrock — your code stays within the AWS boundary and is never used for model training.",
  "claude-cli": "a local Claude CLI under your own subscription — your code stays on this machine.",
  gemini: "the Google Gemini API to produce the score.",
  openai: "your configured OpenAI-compatible endpoint to produce the score.",
  mock: "nowhere — scoring is fully local and deterministic; no code leaves this deployment.",
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
  return (
    <section className="mt-5 rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-300">
      <div className="font-mono text-xs uppercase tracking-[0.25em] text-accent">Where your code goes</div>
      <p className="mt-2">
        During a private scan, a budgeted sample of your repository&apos;s file contents (≤32 files) is sent to{" "}
        {WHERE[provider]} Ascent persists only the derived scores and evidence — never your source.
      </p>
      {isBedrock && (
        <p className="mt-2 text-emerald-300">
          ✓ This deployment routes inference through AWS Bedrock — the enterprise-privacy path.
        </p>
      )}
      {!isBedrock && !isMock && (
        <p className="mt-2 text-slate-400">
          Need a no-training, in-your-cloud guarantee for sensitive code? Route inference through{" "}
          <span className="font-mono text-slate-300">AWS Bedrock</span> (
          <span className="font-mono text-slate-300">LLM_PROVIDER=bedrock</span>) — code stays within your
          AWS boundary and is never used for model training.
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Active inference provider: <span className="font-mono text-slate-300">{provider}</span>
      </p>
    </section>
  );
}
