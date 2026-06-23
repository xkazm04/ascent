// Canonical Content-Disposition filename sanitizers shared by every download route. Previously each
// route inlined one of two flavors and they had drifted (different length caps, different fallbacks)
// across eight handlers. Both are header-injection / response-splitting guards: a caller-influenced
// segment must never reach the `filename="…"` header carrying a quote, CR/LF, `;`, or `/`. One source
// of truth keeps the guard auditable in a single place.

/**
 * Case-PRESERVING segment sanitizer for filenames built from `owner/name[@sha]`-style parts (PDF,
 * SKILL.md, passport, briefing exports). Keeps only filename-safe ASCII (`A-Z a-z 0-9 . _ -`),
 * replacing every other byte with `-`. Dots and underscores survive so a sha / name reads naturally.
 */
export function safeFilenameSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "-");
}

/**
 * Lower-cased slug sanitizer for the CSV/JSON export filenames (usage, history, org/export,
 * org/repositories). Lower-cases, collapses any run of non-`[a-z0-9-]` bytes to a single `-`, trims
 * leading/trailing dashes, caps the length, and falls back to `fallback` when the slug reduces to
 * empty (so the filename is never `ascent-usage--<date>`). `maxLen` lets the usage route keep its
 * historical 64-char cap while the others use the default 80.
 */
export function safeFilenameSlug(s: string, fallback = "export", maxLen = 80): string {
  const cleaned = s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
  return cleaned || fallback;
}
