// query-parsing: the ONE door between what the user typed and what the engine executes. Raw text in,
// a ParsedQuery out — recognized structure lifted into typed clauses, the remainder tokenized through
// the shared matcher, bounded (minimum token length, maximum term count). No call site builds engine
// syntax; the engine (search.ts) only ever receives this artifact. No React.

import { SCHEMA, isFacetField, type FacetField } from "./fixtures";
import { fold, tokenize, type TokenizerOptions } from "./tokenize";

export const MIN_TOKEN = 2;
export const MAX_TERMS = 12;

export type Clause = {
  field: FacetField;
  value: string;
  negated: boolean;
  /** The value is in the field's vocabulary (SCHEMA). An unknown value is lifted and shown broken, never silently dropped. */
  known: boolean;
};

export type ParsedQuery = {
  raw: string;
  /** Free-text words the engine matches (all required at the top rung). */
  terms: string[];
  /** `-word`: excluded at every rung. */
  negTerms: string[];
  /** Balanced-quote spans, as token sequences; verified as adjacent text against the source row. */
  phrases: string[][];
  clauses: Clause[];
  /** Tokens the door refused: under MIN_TOKEN, or past MAX_TERMS. Reported, never silently eaten. */
  dropped: string[];
  /** `word:thing` with an unrecognized prefix — kept as literal text, and named so the user sees it was. */
  literalPrefixes: string[];
};

/** Split raw text into words, honoring balanced quotes; an unbalanced quote is a literal, not an error. */
function words(raw: string): { text: string; phrase: boolean }[] {
  const out: { text: string; phrase: boolean }[] = [];
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      const close = raw.indexOf('"', i + 1);
      if (close > i) {
        out.push({ text: raw.slice(i + 1, close), phrase: true });
        i = close + 1;
        continue;
      }
      i++; // unbalanced: the character is dropped as a literal, the rest is ordinary text
      continue;
    }
    let j = i;
    while (j < raw.length && !/\s/.test(raw[j]) && raw[j] !== '"') j++;
    out.push({ text: raw.slice(i, j), phrase: false });
    i = j;
  }
  return out;
}

export function parseQuery(raw: string, tok: TokenizerOptions): ParsedQuery {
  const q: ParsedQuery = { raw, terms: [], negTerms: [], phrases: [], clauses: [], dropped: [], literalPrefixes: [] };
  const admit = (t: string, into: string[]) => {
    if (t.length < MIN_TOKEN) q.dropped.push(t);
    else if (into === q.terms && q.terms.length >= MAX_TERMS) q.dropped.push(t);
    else into.push(t);
  };
  for (const w of words(raw)) {
    if (w.phrase) {
      const toks = tokenize(w.text, tok).filter((t) => t.length >= MIN_TOKEN);
      if (toks.length > 1) q.phrases.push(toks);
      else if (toks.length === 1) admit(toks[0], q.terms);
      continue;
    }
    const negated = w.text.startsWith("-") && w.text.length > 1;
    const body = negated ? w.text.slice(1) : w.text;
    const m = /^([^:]+):(.+)$/.exec(body);
    if (m && isFacetField(m[1].toLowerCase())) {
      const field = m[1].toLowerCase() as FacetField;
      const value = fold(m[2]);
      q.clauses.push({ field, value, negated, known: SCHEMA[field].values.includes(value) });
      continue;
    }
    if (m) q.literalPrefixes.push(body);
    for (const t of tokenize(body, tok)) admit(t, negated ? q.negTerms : q.terms);
  }
  return q;
}

/** Every word the engine may match, phrases included — the list highlights derive from, never the raw input. */
export const queryWords = (q: ParsedQuery): string[] => [...q.terms, ...q.phrases.flat()];

export const isEmptyQuery = (q: ParsedQuery): boolean => q.terms.length === 0 && q.phrases.length === 0;
