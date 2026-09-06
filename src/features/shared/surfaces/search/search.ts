// full-text-indexing + the degradation ladder: the corpus as documents, an inverted index over three
// weighted fields (or a linear scan — the same Engine type, so the surface cannot tell which answered),
// and `runLadder`, which executes a ParsedQuery rung by rung — as written, unphrased, any term, prefix —
// descending only on empty and naming the rung it answered from. Failure is a different kind from an
// empty result. No React.

import type { Repo } from "./fixtures";
import { isEmptyQuery, queryWords, type ParsedQuery } from "./parse";
import { fold, tokenize, type TokenizerOptions } from "./tokenize";

export const DOC_FIELDS = ["name", "owner", "description"] as const;
export type DocField = (typeof DOC_FIELDS)[number];
/** Field weights, declared once with the index: where meaning concentrates (ranking-and-excerpts). */
export const FIELD_WEIGHT: Record<DocField, number> = { name: 3, owner: 1.5, description: 1 };

export type Doc = { id: string; folded: Record<DocField, string>; tokens: Record<DocField, string[]>; len: number };
type Tf = Record<DocField, number>;

export function toDocs(repos: readonly Repo[], tok: TokenizerOptions): Doc[] {
  return repos.map((r) => {
    const tokens = { name: tokenize(r.name, tok), owner: tokenize(r.owner, tok), description: tokenize(r.description, tok) };
    return {
      id: r.id,
      folded: { name: fold(r.name, tok.fold), owner: fold(r.owner, tok.fold), description: fold(r.description, tok.fold) },
      tokens,
      len: tokens.name.length + tokens.owner.length + tokens.description.length,
    };
  });
}

/** The derived artifact. `docIds` is the index's OWN storage — the drift check reads it, never the source. */
export type Index = { postings: Map<string, Map<string, Tf>>; vocab: string[]; docIds: Set<string>; avgLen: number };

export function buildIndex(docs: readonly Doc[]): Index {
  const postings = new Map<string, Map<string, Tf>>();
  let total = 0;
  for (const d of docs) {
    total += d.len;
    for (const f of DOC_FIELDS) {
      for (const t of d.tokens[f]) {
        let byDoc = postings.get(t);
        if (!byDoc) postings.set(t, (byDoc = new Map()));
        let tf = byDoc.get(d.id);
        if (!tf) byDoc.set(d.id, (tf = { name: 0, owner: 0, description: 0 }));
        tf[f] += 1;
      }
    }
  }
  return { postings, vocab: [...postings.keys()].sort(), docIds: new Set(docs.map((d) => d.id)), avgLen: docs.length ? total / docs.length : 1 };
}

export type Engine = { mode: "index"; index: Index; docs: Map<string, Doc> } | { mode: "scan"; list: Doc[]; docs: Map<string, Doc> };

export type Hit = { id: string; tf: Tf; matched: Set<string> };
export const RUNGS = ["as written", "all terms, unphrased", "any term", "prefix"] as const;
export type Exec =
  | { kind: "ok"; rung: number; hits: Map<string, Hit>; df: Map<string, number>; searched: number; avgLen: number }
  | { kind: "failure"; message: string };

const addTf = (a: Tf, b: Tf): Tf => ({ name: a.name + b.name, owner: a.owner + b.owner, description: a.description + b.description });

/** One term against the engine: exact, or as a prefix. Returns hits keyed by id, plus the term's document frequency. */
function lookup(engine: Engine, term: string, prefix: boolean): Map<string, Hit> {
  const out = new Map<string, Hit>();
  const add = (id: string, tf: Tf, token: string) => {
    const prev = out.get(id);
    if (prev) {
      prev.tf = addTf(prev.tf, tf);
      prev.matched.add(token);
    } else out.set(id, { id, tf, matched: new Set([token]) });
  };
  if (engine.mode === "index") {
    const { postings, vocab } = engine.index;
    if (!prefix) {
      for (const [id, tf] of postings.get(term) ?? []) add(id, tf, term);
      return out;
    }
    let lo = 0;
    let hi = vocab.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (vocab[mid] < term) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < vocab.length && vocab[i].startsWith(term); i++) for (const [id, tf] of postings.get(vocab[i])!) add(id, tf, vocab[i]);
    return out;
  }
  for (const d of engine.list) {
    const tf: Tf = { name: 0, owner: 0, description: 0 };
    let any = false;
    for (const f of DOC_FIELDS) for (const t of d.tokens[f]) if (prefix ? t.startsWith(term) : t === term) (tf[f] += 1), (any = true);
    if (any) add(d.id, tf, term);
  }
  return out;
}

const intersect = (maps: Map<string, Hit>[]): Map<string, Hit> => {
  if (maps.length === 0) return new Map();
  const out = new Map<string, Hit>();
  for (const [id, h] of maps[0]) {
    const rest = maps.slice(1).map((m) => m.get(id));
    if (rest.every(Boolean)) out.set(id, rest.reduce<Hit>((acc, r) => ({ id, tf: addTf(acc.tf, r!.tf), matched: new Set([...acc.matched, ...r!.matched]) }), h));
  }
  return out;
};
const union = (maps: Map<string, Hit>[]): Map<string, Hit> => {
  const out = new Map<string, Hit>();
  for (const m of maps) for (const [id, h] of m) {
    const prev = out.get(id);
    out.set(id, prev ? { id, tf: addTf(prev.tf, h.tf), matched: new Set([...prev.matched, ...h.matched]) } : h);
  }
  return out;
};

/** Phrases are verified against the source row's text, joined back — the index stores tokens, not positions. */
const hasPhrase = (d: Doc, phrase: string[]): boolean => {
  const needle = phrase.join(" ");
  return DOC_FIELDS.some((f) => d.tokens[f].join(" ").includes(needle));
};

export function runLadder(engine: Engine, q: ParsedQuery, opts: { down: boolean }): Exec {
  if (opts.down) return { kind: "failure", message: "engine unreachable (simulated)" };
  const searched = engine.docs.size;
  const avgLen = engine.mode === "index" ? engine.index.avgLen : Math.max(1, engine.list.reduce((a, d) => a + d.len, 0) / Math.max(1, engine.list.length));
  const df = new Map<string, number>();
  const look = (t: string, prefix: boolean) => {
    const m = lookup(engine, t, prefix);
    df.set(t, m.size);
    return m;
  };
  const exclude = (hits: Map<string, Hit>) => {
    for (const n of q.negTerms) for (const id of look(n, false).keys()) hits.delete(id);
    return hits;
  };
  if (isEmptyQuery(q)) {
    const all = new Map<string, Hit>();
    for (const id of engine.docs.keys()) all.set(id, { id, tf: { name: 0, owner: 0, description: 0 }, matched: new Set() });
    return { kind: "ok", rung: 0, hits: exclude(all), df, searched, avgLen };
  }
  const all = queryWords(q);
  // Rung 0: every term AND every phrase, phrases intact.
  let hits = intersect(all.map((t) => look(t, false)));
  for (const [id] of hits) if (!q.phrases.every((p) => hasPhrase(engine.docs.get(id)!, p))) hits.delete(id);
  if (exclude(hits).size > 0) return { kind: "ok", rung: 0, hits, df, searched, avgLen };
  // Rung 1: phrases relaxed to co-occurrence.
  if (q.phrases.length > 0) {
    hits = exclude(intersect(all.map((t) => look(t, false))));
    if (hits.size > 0) return { kind: "ok", rung: 1, hits, df, searched, avgLen };
  }
  // Rung 2: any term.
  hits = exclude(union(all.map((t) => look(t, false))));
  if (hits.size > 0) return { kind: "ok", rung: 2, hits, df, searched, avgLen };
  // Rung 3: any term as a prefix.
  hits = exclude(union(all.map((t) => look(t, true))));
  return { kind: "ok", rung: 3, hits, df, searched, avgLen };
}
