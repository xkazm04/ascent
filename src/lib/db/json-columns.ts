/** Decode an optional JSON-in-TEXT string list using the existing read compatibility policy.
 * Null, malformed JSON and non-arrays yield []; non-strings are dropped. Order and duplicates stay.
 * This decoder does not distinguish corrupt data from an absent optional list. */
export function parseStringArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
