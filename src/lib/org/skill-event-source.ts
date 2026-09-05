// `OrgSkillEvent.source` as a CLOSED vocabulary — and the normalizer that makes closing it safe.
//
// The column was documented as `cli | hook | ci | web` and validated nowhere: `recordSkillEvents`
// clipped it to 200 characters of free text. The shipped CLI then used that freedom as a second
// column — `reportDrift` emits `source: "cli:diverged"` — so a naive enum would reject every event
// the installed fleet already sends, which is the worse error: dropping a real invocation over a
// label. Hence PREFIX NORMALIZATION rather than rejection:
//
//   "hook"          → { source: "hook",     detail: null }
//   "cli:diverged"  → { source: "cli",      detail: "diverged" }     ← the legacy wire form
//   "jenkins"       → { source: null,       detail: "jenkins" }      ← unrecognized, never dropped
//
// Nothing rewrites the rows already in the table: legacy strings stay as written and are normalized
// on READ, so there is no destructive migration to get wrong.
//
// PURE by construction — imported by client components (the source chip) and by the server writer
// alike, so it must never reach for `@/lib/db`.

/** The closed set. `mcp` is shipped here and wired by the MCP lane (#17); `registry` by #36. */
export const SKILL_EVENT_SOURCES = ["cli", "hook", "ci", "web", "registry", "mcp"] as const;

export type SkillEventSource = (typeof SKILL_EVENT_SOURCES)[number];

/** Longest value the `detail` column keeps — the same clip `source` has always had. */
export const SOURCE_DETAIL_MAX = 200;

const KNOWN = new Set<string>(SKILL_EVENT_SOURCES);

export function isSkillEventSource(v: string): v is SkillEventSource {
  return KNOWN.has(v);
}

/**
 * Split a reported `source` into the enum value and whatever sub-state the producer smuggled beside
 * it. Never throws and never rejects: an unrecognized value yields `source: null` with the raw text
 * preserved in `detail`, because the event itself is the fact worth keeping.
 */
export function normalizeEventSource(raw: string | null | undefined): {
  source: SkillEventSource | null;
  detail: string | null;
} {
  if (typeof raw !== "string") return { source: null, detail: null };
  const trimmed = raw.trim();
  if (!trimmed) return { source: null, detail: null };

  const clip = (v: string) => (v ? v.slice(0, SOURCE_DETAIL_MAX) : null);
  const lower = trimmed.toLowerCase();
  if (isSkillEventSource(lower)) return { source: lower, detail: null };

  // `<prefix>:<detail>` — the legacy CLI form. Only the FIRST colon splits, so a detail may contain
  // colons of its own without being re-parsed into something it is not.
  const colon = lower.indexOf(":");
  if (colon > 0) {
    const head = lower.slice(0, colon);
    if (isSkillEventSource(head)) {
      return { source: head, detail: clip(trimmed.slice(colon + 1).trim()) };
    }
  }
  return { source: null, detail: clip(trimmed) };
}

/** Human label for a source, for a chip beside an event. `null` is "unattributed", never "unknown
 *  client" — the absence is a reporting gap, not a claim about who reported. */
export function skillEventSourceLabel(source: SkillEventSource | null): string {
  switch (source) {
    case "cli":
      return "CLI";
    case "hook":
      return "Hook";
    case "ci":
      return "CI";
    case "web":
      return "Web";
    case "registry":
      return "Registry";
    case "mcp":
      return "MCP";
    default:
      return "Unattributed";
  }
}
