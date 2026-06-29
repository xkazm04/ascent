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
