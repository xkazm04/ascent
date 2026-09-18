/** Decode a JSON-in-TEXT string list.
 * JSON `[]` is a measured empty list. Null, malformed JSON, and non-arrays return null so unread
 * data is not counted as "found nothing". Non-strings are dropped; order and duplicates stay.
 * Callers that want the old compatibility fallback coalesce with `?? []`. */
export function parseStringArray(s: string | null | undefined): string[] | null {
  if (s == null || s === "") return null;
  try {
    const p = JSON.parse(s);
    if (!Array.isArray(p)) return null;
    return p.filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
}
