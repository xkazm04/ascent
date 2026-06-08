// Env-driven LLM tuning knobs shared by the real providers. Temperature and Bedrock's maxTokens were
// hard-coded literals, so a big-repo assessment could be truncated by the fixed cap and determinism
// couldn't be tuned without a code change — inconsistent with the existing GEMINI_MODEL /
// BEDROCK_MODEL_ID / LLM_TIMEOUT_MS env convention. These default to the prior literals, so unset
// envs preserve exact behavior.

/** Read an env var as a number, falling back to `fallback` when unset/blank/non-numeric. */
export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
