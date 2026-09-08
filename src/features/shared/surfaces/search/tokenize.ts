// The scene's matching policy in ONE place: how text becomes tokens, and how both sides of a match are
// normalized. The index and the query door call the same two functions, so folding at index time and
// folding at query time cannot drift apart (query-parsing's "one named matcher"; full-text-indexing's
// "identical folding on both sides"). No React.

export type TokenizerOptions = {
  /** Case + diacritic folding (NFD, strip combining marks). Off shows accented input failing to match. */
  fold: boolean;
  /** Split identifier humps (`authService` → auth, service) so a code-adjacent corpus is searchable by fragment. */
  splitHumps: boolean;
};

export const DEFAULT_TOKENIZER: TokenizerOptions = { fold: true, splitHumps: true };

/** Lowercase always; with `on`, also strip diacritics so "résumé" and "resume" are one token. */
export function fold(s: string, on = true): string {
  const lower = s.toLowerCase();
  return on ? lower.normalize("NFD").replace(/[̀-ͯ]/g, "") : lower;
}

/** Word split on anything that is not a letter or digit; humps optionally become boundaries first. */
export function tokenize(s: string, o: TokenizerOptions = DEFAULT_TOKENIZER): string[] {
  const humped = o.splitHumps ? s.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2") : s;
  return fold(humped, o.fold)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
