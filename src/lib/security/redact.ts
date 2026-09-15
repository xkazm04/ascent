// ONE REDACTOR for credential-shaped text, applied wherever text this product did not write leaves for
// somewhere it should not carry a secret: the eval log on disk (`@/lib/llm/eval-log`) and every LLM
// prompt that quotes text written by agents (`sanitizeAgentText` in `@/lib/llm/untrusted`).
//
// It is the union of two lists. Ascent's eval-log list was built for committed repo files (PEM blocks,
// Google keys, the labelled AWS secret). The AI Engineering Coach (microsoft/ai-engineering-coach@18b1a3d,
// src/core/redact-secrets.ts) redacts session transcripts before a model reads them, and adds the shapes
// a developer pastes while debugging: JWTs, credentials inside a connection string, GitLab PATs, Slack
// app tokens, GitHub fine-grained PATs, and quoted or key=value assignments. Two copies of a security
// control drift, so both callers import this one.
//
// CONSERVATIVE BY DESIGN. Only fixed token prefixes and explicitly LABELLED assignments are matched. A bare
// 40-character blob is left alone: it is indistinguishable from a commit hash, and redacting every one
// would gut the excerpts and lessons the redacted text exists to carry. Where a shape has a harmless
// frame (a key name, a URI scheme, an auth scheme) the frame is kept so the text still reads.
//
// PURE and dependency-free, so a client module that imports `untrusted.ts` stays client-safe.

export const REDACTED = "[REDACTED]";

export interface RedactionPattern {
  /** A stable name, used by the tests to pin one positive and one near-miss per shape. */
  name: string;
  re: RegExp;
  replace: string;
}

const ASSIGN_KEY = "(api[_-]?key|access[_-]?key|secret|token|password|passwd|credentials?)";

/**
 * Ordered. Whole-token shapes run before the assignment shapes, so `api_key=sk-...` loses the key to its
 * own pattern first and the assignment pattern then sees only the marker.
 */
export const REDACTION_PATTERNS: readonly RedactionPattern[] = [
  // PEM private-key BLOCKS, matched whole (the material is the secret, not the header). A block cut off
  // by an excerpt budget has no END line, so an unterminated block runs to the end of the text.
  {
    name: "private-key",
    re: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY(?: BLOCK)?-----|$)/g,
    replace: REDACTED,
  },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: REDACTED },
  { name: "stripe-key", re: /\b[srp]k_(?:live|test)_[0-9A-Za-z]{10,}\b/g, replace: REDACTED },
  // OpenAI-style (also sk-ant-, sk-or-). 16 is the eval-log floor; the coach's is 20.
  { name: "sk-api-key", re: /\b(?:sk|pk)-[A-Za-z0-9_-]{16,}\b/g, replace: REDACTED },
  { name: "github-token", re: /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/g, replace: REDACTED },
  { name: "gitlab-pat", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, replace: REDACTED },
  { name: "npm-token", re: /\bnpm_[A-Za-z0-9]{36}\b/g, replace: REDACTED },
  { name: "aws-access-key-id", re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, replace: REDACTED },
  // The AWS SECRET key has no prefix, so only its labelled form is tractable.
  { name: "aws-secret-labelled", re: /\b(aws_secret_access_key|aws_session_token)(\s*[=:]\s*)\S+/gi, replace: `$1$2${REDACTED}` },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replace: REDACTED },
  { name: "slack-app-token", re: /\bxapp-[0-9]-[A-Za-z0-9-]{10,}\b/g, replace: REDACTED },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replace: REDACTED },
  // scheme://user:pass@host keeps the scheme and the host.
  { name: "connection-string", re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, replace: `$1${REDACTED}@` },
  { name: "auth-header", re: /\b(Bearer|Basic|Authorization:?)\s+[A-Za-z0-9._~+/=-]{16,}/gi, replace: `$1 ${REDACTED}` },
  // "password": "two words here" - a quoted value may hold spaces. Each quote may be JSON-escaped
  // (\"), because a tool result reaches the model as serialized JSON: without the optional backslash
  // the same lesson was masked in a prose prompt and leaked verbatim through the memory tool.
  {
    name: "quoted-assignment",
    re: new RegExp(`\\b${ASSIGN_KEY}(\\\\?["']?\\s*[:=]\\s*)(\\\\?["'])((?:(?!\\3).){4,512})\\3`, "gi"),
    replace: `$1$2$3${REDACTED}$3`,
  },
  {
    name: "key-value-assignment",
    re: new RegExp(`\\b${ASSIGN_KEY}(\\\\?["']?\\s*[:=]\\s*)(\\\\?["']?)[^\\s"'\`;,\\\\]{8,512}\\3`, "gi"),
    replace: `$1$2$3${REDACTED}$3`,
  },
];

/** Mask credential-shaped substrings, keeping the surrounding text intact. */
export function redactSecrets(text: string): string {
  if (!text) return text;
  return REDACTION_PATTERNS.reduce((acc, p) => acc.replace(p.re, p.replace), text);
}
