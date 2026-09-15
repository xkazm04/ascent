// The pure pipeline: the door lifts structure and bounds the expression, the index and the scan agree,
// the ladder descends only on empty and names its rung, failure is not an empty result, the order is
// total, excerpts mark what the engine matched, facet counts follow the disjunctive convention, a dead
// view clause is visible, and the palette's shape scoring puts initials over interior substrings.

import { describe, expect, it } from "vitest";
import { activeChips, DEFAULT_PREDICATE, facetCounts, isNarrowed, toggle, withClauses } from "./facets";
import { repoRows } from "./fixtures";
import { fuzzy, rankItems } from "./palette";
import { MAX_TERMS, parseQuery } from "./parse";
import { excerpt, rankHits } from "./rank";
import { buildIndex, runLadder, toDocs, type Engine } from "./search";
import { DEFAULT_TOKENIZER, tokenize } from "./tokenize";
import { SEED_VIEWS, validateView } from "./views";

const repos = repoRows(5_000);
const docs = toDocs(repos, DEFAULT_TOKENIZER);
const byId = new Map(docs.map((d) => [d.id, d]));
const index: Engine = { mode: "index", index: buildIndex(docs), docs: byId };
const scan: Engine = { mode: "scan", list: docs, docs: byId };
const q = (s: string) => parseQuery(s, DEFAULT_TOKENIZER);

describe("the door", () => {
  it("lifts known prefixes, keeps unknown ones literal, honors quotes, bounds the expression", () => {
    const p = q('status:fail -lang:go "session events" note:keep a -slow x'.padEnd(0) + " " + Array.from({ length: 20 }, (_, i) => `term${i}`).join(" "));
    expect(p.clauses).toEqual([
      { field: "status", value: "fail", negated: false, known: true },
      { field: "lang", value: "go", negated: true, known: true },
    ]);
    expect(p.phrases).toEqual([["session", "events"]]);
    expect(p.literalPrefixes).toEqual(["note:keep"]);
    expect(p.negTerms).toEqual(["slow"]);
    expect(p.terms.length).toBe(MAX_TERMS);
    expect(p.dropped).toContain("a");
    expect(q('status:bogus').clauses[0].known).toBe(false);
    expect(q('"unbalanced quote').terms).toEqual(["unbalanced", "quote"]);
  });

  it("folds both sides: accented input matches, and humps split identifiers", () => {
    expect(tokenize("Résumé-Parser")).toEqual(["resume", "parser"]);
    expect(tokenize("authService")).toEqual(["auth", "service"]);
    expect(tokenize("authService", { fold: true, splitHumps: false })).toEqual(["authservice"]);
  });
});

describe("the engine and the ladder", () => {
  it("index and scan answer the same question the same way", () => {
    for (const s of ["resume", "session events", "auth service", "ledger"]) {
      const a = runLadder(index, q(s), { down: false });
      const b = runLadder(scan, q(s), { down: false });
      if (a.kind !== "ok" || b.kind !== "ok") throw new Error("failure");
      expect([...a.hits.keys()].sort()).toEqual([...b.hits.keys()].sort());
      expect(a.rung).toBe(b.rung);
    }
  });

  it("descends only on empty and names the rung; prefix expands the matched token", () => {
    const written = runLadder(index, q('"session events"'), { down: false });
    expect(written.kind === "ok" && written.rung).toBe(0);
    const prefix = runLadder(index, q("indexi"), { down: false });
    expect(prefix.kind === "ok" && prefix.rung).toBe(3);
    if (prefix.kind === "ok") expect([...prefix.hits.get("repo-1")!.matched]).toEqual(["indexing"]);
    const nothing = runLadder(index, q("zzzz"), { down: false });
    expect(nothing.kind === "ok" && nothing.hits.size).toBe(0);
  });

  it("failure is a different kind from an empty result", () => {
    expect(runLadder(index, q("zzzz"), { down: true }).kind).toBe("failure");
  });

  it("ranks in a total order and excerpts mark the engine's tokens", () => {
    const exec = runLadder(index, q("auth"), { down: false });
    const ranked = rankHits(exec, byId, new Map(repos.map((r) => [r.id, r])), "relevance");
    expect(byId.get(ranked[0].repo.id)!.tokens.name).toContain("auth"); // a name match outranks description mentions
    for (let i = 1; i < ranked.length; i++) {
      const a = ranked[i - 1];
      const b = ranked[i];
      expect(a.score > b.score || (a.score === b.score && (a.repo.updatedAt > b.repo.updatedAt || (a.repo.updatedAt === b.repo.updatedAt && a.repo.id < b.repo.id)))).toBe(true);
    }
    const doc = byId.get("repo-1")!;
    const ex = excerpt(repos[0].description, doc.folded.description, ["indexing"], 40);
    expect(ex.segments.some((s) => s.mark && s.text === "indexing")).toBe(true);
    expect(ex.leading).toBe(true);
  });
});

describe("facets and views", () => {
  it("counts under the disjunctive convention and folds clauses into one predicate", () => {
    const p = toggle(DEFAULT_PREDICATE, "include", "status", "fail");
    const c = facetCounts(repos, p);
    expect(c.status.get("warn")).toBeGreaterThan(0); // the facet's own selection is lifted
    expect(c.status.get("archived")).toBeUndefined(); // the default exclusion still applies
    expect(c.lang.size).toBeGreaterThan(0);
    const merged = withClauses(p, q("lang:go").clauses);
    expect(merged.include.lang.has("go")).toBe(true);
    expect(isNarrowed(DEFAULT_PREDICATE)).toBe(false);
    expect(isNarrowed(p)).toBe(true);
    expect(activeChips(DEFAULT_PREDICATE)).toEqual([{ side: "exclude", field: "status", value: "archived", isDefault: true }]);
  });

  it("a retired clause is dead at application, never dropped", () => {
    expect(validateView(SEED_VIEWS[3].predicate)).toEqual([{ field: "tier", values: ["gold"], why: "field retired from the schema" }]);
    expect(validateView(SEED_VIEWS[1].predicate)).toEqual([]);
  });
});

describe("the palette", () => {
  it("initials outrank an interior substring; the floor rejects noise; history breaks ties only", () => {
    expect(fuzzy("as", "authService")!.score).toBeGreaterThan(fuzzy("as", "cache-parser")?.score ?? -Infinity);
    const items = [
      { id: "b", kind: "command" as const, label: "Sort by recent" },
      { id: "a", kind: "command" as const, label: "Sort by relevance" },
      { id: "z", kind: "command" as const, label: "Clear filters" },
    ];
    const r = rankItems(items, "sor", ["a"]);
    expect(r.shown.map((s) => s.item.id)).toEqual(["a", "b"]);
    expect(r.rejected).toBe(1);
    expect(rankItems(items, "", ["z"]).shown[0].item.id).toBe("z");
  });
});
