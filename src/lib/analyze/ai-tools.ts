// Canonical AI coding tool/agent vocabulary — the SINGLE source for every AI-detection regex in
// the analyze layer: PR author bots (pulls.ts AI_AGENT), commit co-author / "generated with"
// trailers (index.ts AI_TRAILER, passport.ts), the AI-fingerprint marker (pulls.ts AI_MARKER),
// and the per-tool counters (pulls.ts AI_TOOLS). These were five hand-copied lists that had
// already drifted (only some included `sweep`/`sourcery`/`github-actions`; `AI_MARKER`'s
// "generated with" branch dropped half the tools). Add or rename a tool HERE and it is recognized
// everywhere at once. The tokens are lowercase, regex-safe substrings (no metacharacters beyond a
// literal `-`), matched case-insensitively against logins / titles / bodies / labels / messages.

/** One AI tool/agent: a display `name` (used in PR tool counts) + the lowercase token matched in text. */
export interface AiTool {
  name: string;
  token: string;
}

/**
 * The UNION of every tool/agent name that any detector recognized — the intended single vocabulary.
 * Order is the display order for the per-tool counter; detection itself is order-independent.
 */
export const AI_TOOLS: AiTool[] = [
  { name: "Claude", token: "claude" },
  { name: "Copilot", token: "copilot" },
  { name: "Cursor", token: "cursor" },
  { name: "Devin", token: "devin" },
  { name: "Codex", token: "codex" },
  { name: "Gemini", token: "gemini" },
  { name: "Aider", token: "aider" },
  { name: "Sweep", token: "sweep" },
  { name: "Sourcery", token: "sourcery" },
  { name: "GitHub Actions", token: "github-actions" },
];

/** The tool tokens joined as a regex-alternation group body, e.g. `claude|copilot|…|github-actions`. */
export const AI_TOOL_ALT = AI_TOOLS.map((t) => t.token).join("|");

/**
 * AI REVIEW bots (W2) — agents that REVIEW PRs rather than author them. Kept SEPARATE from
 * `AI_TOOLS`: these tokens mark an AI pre-review (pulls.ts `aiPreReviewedRate`), not AI authorship,
 * and folding them into `AI_TOOL_ALT` would let a review bot's mention flag a PR as AI-authored.
 * Lowercase, regex-safe substrings matched case-insensitively against review-author logins
 * (e.g. `coderabbitai[bot]`, `copilot-pull-request-reviewer[bot]`, `greptile-apps[bot]`).
 */
export const AI_REVIEW_BOTS: string[] = [
  "coderabbit", // coderabbitai[bot]
  "copilot-pull-request-reviewer", // GitHub Copilot code review
  "greptile", // greptile-apps[bot]
  "gemini-code-assist", // Gemini Code Assist review bot
  "qodo", // Qodo Merge (formerly pr-agent)
  "ellipsis-dev", // Ellipsis review bot
];

/** The review-bot tokens as a regex-alternation group body. */
export const AI_REVIEW_BOT_ALT = AI_REVIEW_BOTS.join("|");

/**
 * The commit-message TRAILER vocabulary (W2) — the regex body matching an AI attribution trailer
 * (`Co-Authored-By:`/`Assisted-By:` naming a tool, "generated with Claude Code", the 🤖 marker, an
 * anthropic noreply address). SINGLE source for every commit-trailer detector: commit-level
 * `AI_TRAILER` (index.ts, over the 30 snapshot commits) and PR-level trailer attribution (pulls.ts,
 * over merge-commit + PR-commit messages) both compile this same body, so adding a trailer phrase
 * here — as `assisted-by:` was — is recognized by both at once. Compile with the `i` flag.
 */
export const AI_TRAILER_SOURCE = `(?:co-authored-by|assisted-by):\\s*(?:${AI_TOOL_ALT})|generated with \\[?claude code|🤖 generated with|noreply@anthropic`;
