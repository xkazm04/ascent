// Source excerpts for the mechanism drawer — verbatim from the scene's own files (parse.ts, search.ts,
// rank.ts, facets.ts, views.ts, palette.ts, rules.ts and the panels). Kept as string constants so the
// drawer needs no build step; when the code moves, these move with it in the same commit.

export const SRC_PARSE = `// parse.ts — one door: raw text in, a bounded ParsedQuery out; the engine never sees raw text
export const MIN_TOKEN = 2;
export const MAX_TERMS = 12;
const m = /^([^:]+):(.+)$/.exec(body);
if (m && isFacetField(m[1].toLowerCase())) {          // a closed prefix set, lifted into a typed clause
  const value = fold(m[2]);
  q.clauses.push({ field, value, negated, known: SCHEMA[field].values.includes(value) });
  continue;
}
if (m) q.literalPrefixes.push(body);                   // an unknown prefix stays literal text, and says so
for (const t of tokenize(body, tok)) admit(t, negated ? q.negTerms : q.terms);
// search.ts — the ladder descends only on empty and names its rung
if (exclude(hits).size > 0) return { kind: "ok", rung: 0, hits, df, searched, avgLen };   // as written
if (q.phrases.length > 0) { hits = …; if (hits.size > 0) return { …, rung: 1 }; }          // unphrased
hits = exclude(union(all.map((t) => look(t, false)))); if (hits.size > 0) return { …, rung: 2 }; // any term
hits = exclude(union(all.map((t) => look(t, true))));  return { …, rung: 3 };              // prefix
if (opts.down) return { kind: "failure", message: "engine unreachable (simulated)" }; // never an empty "ok"`;

export const SRC_INDEX = `// tokenize.ts — the same fold on both sides of every match
export function fold(s, on = true) { const lower = s.toLowerCase(); return on ? lower.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "") : lower; }
export function tokenize(s, o) {
  const humped = o.splitHumps ? s.replace(/([\\p{Ll}\\p{N}])(\\p{Lu})/gu, "$1 $2") : s;   // authService → auth service
  return fold(humped, o.fold).split(/[^\\p{L}\\p{N}]+/u).filter(Boolean);
}
// search.ts — the index is a derivation with its OWN storage (docIds), built from the source
export function buildIndex(docs) { …; return { postings, vocab: [...postings.keys()].sort(), docIds: new Set(docs.map((d) => d.id)), avgLen }; }
// useFleetSearch.ts — posture: sync reaps with the write; "grow" lags until the named recomputation runs
const indexReaped = indexOpts.posture === "sync" ? deleted : reaped;
const rebuild = () => setReaped(deleted);              // the documented, invokable recomputation
// IndexPanel.tsx — the gate reads the artifact, compares != (not <), and counts ghosts the query resolved to nothing
const indexed = s.engine.docs.size;
const drift = indexed !== s.source.length;`;

export const SRC_RANK = `// rank.ts — the combination rule, written down once
const norm = K * (doc.len / exec.avgLen);
for (const f of DOC_FIELDS) if (hit.tf[f] > 0) s += FIELD_WEIGHT[f] * (hit.tf[f] / (hit.tf[f] + norm)); // name ×3 · owner ×1.5 · description ×1
for (const t of hit.matched) rarity += Math.log(1 + N / Math.max(1, exec.df.get(t) ?? 1));
// a TOTAL order: score, then recency, then id — nothing left for the engine to resolve differently
out.sort((a, b) => (sort === "relevance" ? b.score - a.score : 0) || b.repo.updatedAt - a.repo.updatedAt || (a.repo.id < b.repo.id ? -1 : 1));
// excerpt(): marks come from hit.matched — the engine's tokens, prefix-expanded — found in the folded twin,
// applied to the original by offset; the window is chosen where the spans cluster, not at the head
const ex = excerpt(r.repo.description, doc.folded.description, r.hit.matched);
{ex.leading ? "…" : ""}{ex.segments.map((seg) => seg.mark ? <mark>{seg.text}</mark> : <span>{seg.text}</span>)}{ex.trailing ? "…" : ""}
// bands render; scores do not
export function band(rank, s, top) { if (s <= 0) return "listed"; return rank === 0 || s >= top * 0.8 ? "best match" : "also matched"; }`;

export const SRC_FACETS = `// facets.ts — OR within a field, AND across; the default slice is a predicate like any other
export const DEFAULT_PREDICATE = { include: empty(), exclude: { ...empty(), status: new Set(["archived"]) } };
export function passes(r, p, lift = null) {
  for (const f of FACET_FIELDS) {
    const v = fieldValue(r, f);
    if (p.exclude[f].has(v)) return false;
    if (f !== lift && p.include[f].size > 0 && !p.include[f].has(v)) return false;   // lift = the disjunctive count
  }
  return true;
}
export function facetCounts(rows, p) { for (const r of rows) for (const f of FACET_FIELDS) if (passes(r, p, f)) count(f, fieldValue(r, f)); }
export const isNarrowed = (p) => key(p) !== key(DEFAULT_PREDICATE);   // ONE predicate for the bar, the empty state, the badge
// useFleetSearch.ts — any change to the predicate re-opens the window at page one: reset, not clamp
const setPredicate = useCallback((p) => (setPredicateRaw(p), resetPage()), [resetPage]);
const full = useMemo(() => withClauses(predicate, parsed.clauses), [predicate, parsed.clauses]);   // chips + panel, one predicate`;

export const SRC_VIEWS = `// views.ts — the stored form is the parsed predicate; a saved clause may outlive its field
export type StoredClause = { field: string; values: string[] };
export function validateView(v) {           // against the live SCHEMA, at application time
  for (const c of [...v.include, ...v.exclude]) {
    if (!isFacetField(c.field)) dead.push({ field: c.field, values: c.values, why: "field retired from the schema" });
    else { const unknown = c.values.filter((x) => !SCHEMA[c.field].values.includes(x)); if (unknown.length) dead.push({ …, why: "value no longer in the vocabulary" }); }
  }
}
export const mintViewId = () => \`view-\${++minted}\`;   // identity minted once; a rename never touches it
// ViewsPanel.tsx — a dead clause withholds results (an impossible include) rather than dropping the clause and widening them
const p = validateView(v.predicate).length ? { ...live, include: { ...live.include, status: new Set(["∅ withheld"]) } } : live;
setSnapshot(toStored(v.predicate.text, p, v.predicate.sort));
const dirty = isDirty(current, snapshot);   // near the view, not at it → update · save as new · revert`;

export const SRC_PALETTE = `// palette.ts — scored by the SHAPE of the match, with a floor
score += isBoundary(label, idx) ? 10 : 2;      // word start or a case hump outranks an interior hit
if (consecutive) score += 6;                   // a run is stronger evidence than the same letters scattered
score -= Math.max(0, idx - at);                // the gap penalty grows with distance
if (positions[0] === 0) score += 20;           // exact prefix of a short label is the strongest match there is
score += Math.round((20 * q.length) / l.length);
if (!m || m.score < FLOOR) rejected += 1;      // below the floor a candidate does not appear at all
// order: text score, then the personal prior, then stable id — history breaks ties, never overrides a match
scored.sort((a, b) => b.match.score - a.match.score || prior(a.item.id) - prior(b.item.id) || byId(a.item, b.item));
// useFleetSearch.ts — ONE registry; the action strip and the palette both render \`commands\`
const commands = [{ id: "cmd:clear", kind: "command", label: "Clear filters", keywords: "reset predicate", run: … }, …];
// PalettePanel.tsx — enter runs the top hit; escape leaves everything as it was
else if (e.key === "Enter" && shown[cursor]) (e.preventDefault(), pick(shown[cursor].item.id));`;

export const SRC_RULES = `// rules.ts — the typing context is the static twin of the runtime row
export const TYPING_CONTEXT = { name: "string", owner: "string", lang: "string", status: "string", level: "int", findings: "int", archived: "bool", tags: "list<string>" };
function typeOf(n) {                                   // bottom-up; stops at the node that cannot type
  case "id": if (!(n.name in TYPING_CONTEXT)) throw new Ill(\`unknown identifier "\${n.name}"\`, n.s, n.e);
  case "bin": if (n.op === "==" || n.op === "!=") return want(l === r && …, "equality wants two operands of one type"), "bool";
              return want(l === "int" && r === "int", "can only compare ints"), "bool";
}
export function compileRule(src) {                      // the one door: editor, persisted rule, import
  const root = parse(lex(src));
  const type = typeOf(root);
  if (type !== "bool") throw new Ill(\`expected bool but got \${type}\`, root.s, root.e);   // a program that is not a filter
  return { ok: true, type: "bool", run: (row) => evaluate(root, row) === true };
  // catch → { ok: false, message, at: [s, e], snippet: src.slice(s, e) }   the verdict names the node
}
// RulesPanel.tsx — a rule that fails to load fails visibly on the surface it filters
{!active.verdict.ok ? <p role="alert">“{active.name}” no longer types … Its lane shows nothing — not everything.</p> : null}`;
