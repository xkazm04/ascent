// typed-filter-language: the OTHER box. A user-authored predicate — identifiers, operators, literals,
// lists — parsed into a tree and typed bottom-up from a closed type set BEFORE the first row is seen.
// The verdict names the offending node; the root must synthesize to bool; an ill-typed rule is refused,
// never coerced. Every writer (editor, persisted rules) passes through `compileRule`. No React.

import type { Repo } from "./fixtures";
import { Ill, lex, type Tok } from "./ruleLex";

export type RType = "string" | "int" | "bool" | "regex" | "list<string>";
export type RuleRow = { name: string; owner: string; lang: string; status: string; level: number; findings: number; archived: boolean; tags: string[] };

/** The typing context: the static twin of the runtime row. What a rule may name, and nothing else. */
export const TYPING_CONTEXT: Record<string, RType> = { name: "string", owner: "string", lang: "string", status: "string", level: "int", findings: "int", archived: "bool", tags: "list<string>" };

export const toRuleRow = (r: Repo): RuleRow => ({ name: r.name, owner: r.owner, lang: r.lang, status: r.status, level: r.level, findings: r.findings, archived: r.status === "archived", tags: r.tags });

type Node =
  | { k: "lit"; type: RType; v: unknown; s: number; e: number }
  | { k: "list"; items: Node[]; s: number; e: number }
  | { k: "id"; name: string; s: number; e: number }
  | { k: "un"; op: "not" | "-"; x: Node; s: number; e: number }
  | { k: "bin"; op: string; l: Node; r: Node; s: number; e: number };

const CMP = new Set(["==", "!=", "<", "<=", ">", ">=", "contains", "startswith", "matches"]);

function parse(toks: Tok[]): Node {
  let i = 0;
  // `lex` always ends the stream with an `end` sentinel; reading past it yields that sentinel again.
  const END: Tok = toks[toks.length - 1] ?? { k: "end", t: "", s: 0, e: 0 };
  const peek = (): Tok => toks[i] ?? END;
  const take = (): Tok => toks[i++] ?? END;
  const is = (t: string) => peek().t === t && peek().k !== "str";
  const expect = (t: string) => {
    if (!is(t)) throw new Ill(`expected "${t}"`, peek().s, Math.max(peek().e, peek().s + 1));
    return take();
  };
  const primary = (): Node => {
    const t = take();
    if (t.k === "num") return { k: "lit", type: "int", v: Number(t.t), s: t.s, e: t.e };
    if (t.k === "str") return { k: "lit", type: "string", v: JSON.parse(t.t), s: t.s, e: t.e };
    if (t.k === "re") {
      try {
        return { k: "lit", type: "regex", v: new RegExp(t.t.slice(1, -1)), s: t.s, e: t.e };
      } catch {
        throw new Ill("invalid regular expression", t.s, t.e);
      }
    }
    if (t.k === "id" && (t.t === "true" || t.t === "false")) return { k: "lit", type: "bool", v: t.t === "true", s: t.s, e: t.e };
    if (t.k === "id" && t.t !== "not" && t.t !== "and" && t.t !== "or") return { k: "id", name: t.t, s: t.s, e: t.e };
    if (t.t === "(") {
      const x = expr();
      expect(")");
      return x;
    }
    if (t.t === "[") {
      const items: Node[] = [];
      while (!is("]")) {
        if (peek().k === "end") throw new Ill("unclosed list", t.s, peek().e);
        items.push(expr());
        if (!is("]")) expect(",");
      }
      const close = take();
      return { k: "list", items, s: t.s, e: close.e };
    }
    throw new Ill(t.k === "end" ? "unexpected end of rule" : `unexpected "${t.t}"`, t.s, Math.max(t.e, t.s + 1));
  };
  const unary = (): Node => (is("-") ? ((t) => ((x) => ({ k: "un", op: "-", x, s: t.s, e: x.e }) as Node)(unary()))(take()) : primary());
  const add = (): Node => {
    let l = unary();
    while (is("+") || is("-")) {
      const op = take().t;
      const r = unary();
      l = { k: "bin", op, l, r, s: l.s, e: r.e };
    }
    return l;
  };
  const cmp = (): Node => {
    const l = add();
    if (CMP.has(peek().t) && peek().k !== "str") {
      const op = take().t;
      const r = add();
      return { k: "bin", op, l, r, s: l.s, e: r.e };
    }
    return l;
  };
  const not = (): Node => (is("not") ? ((t) => ((x) => ({ k: "un", op: "not", x, s: t.s, e: x.e }) as Node)(not()))(take()) : cmp());
  const and = (): Node => {
    let l = not();
    while (is("and")) (take(), (l = ((r) => ({ k: "bin", op: "and", l, r, s: l.s, e: r.e }) as Node)(not())));
    return l;
  };
  const expr = (): Node => {
    let l = and();
    while (is("or")) (take(), (l = ((r) => ({ k: "bin", op: "or", l, r, s: l.s, e: r.e }) as Node)(and())));
    return l;
  };
  const root = expr();
  if (peek().k !== "end") throw new Ill(`unexpected "${peek().t}"`, peek().s, peek().e);
  return root;
}

/** Bottom-up synthesis: every node gets a type from the closed set, or the pass stops at the node that cannot. */
function typeOf(n: Node): RType {
  switch (n.k) {
    case "lit":
      return n.type;
    case "list":
      for (const it of n.items) if (typeOf(it) !== "string") throw new Ill("lists hold strings only", it.s, it.e);
      return "list<string>";
    case "id": {
      const bound = TYPING_CONTEXT[n.name];
      if (bound === undefined) throw new Ill(`unknown identifier "${n.name}"`, n.s, n.e);
      return bound;
    }
    case "un": {
      const x = typeOf(n.x);
      if (n.op === "not" && x !== "bool") throw new Ill(`"not" wants a bool, got ${x}`, n.x.s, n.x.e);
      if (n.op === "-" && x !== "int") throw new Ill(`negation wants an int, got ${x}`, n.x.s, n.x.e);
      return x;
    }
    case "bin": {
      const l = typeOf(n.l);
      const r = typeOf(n.r);
      const want = (ok: boolean, msg: string): void => {
        if (!ok) throw new Ill(`${msg} (got ${l} ${n.op} ${r})`, n.s, n.e);
      };
      if (n.op === "and" || n.op === "or") return want(l === "bool" && r === "bool", `"${n.op}" wants two bools`), "bool";
      if (n.op === "+") return want(l === "string" || (l === "int" && r === "int"), '"+" wants int + int, or string + anything'), l === "string" ? "string" : "int";
      if (n.op === "-") return want(l === "int" && r === "int", '"-" wants two ints'), "int";
      if (n.op === "==" || n.op === "!=") return want(l === r && l !== "regex" && l !== "list<string>", "equality wants two operands of one type"), "bool";
      if (n.op === "contains") return want((l === "list<string>" || l === "string") && r === "string", '"contains" wants a list or string on the left and a string on the right'), "bool";
      if (n.op === "startswith") return want(l === "string" && r === "string", '"startswith" wants two strings'), "bool";
      if (n.op === "matches") return want(l === "string" && r === "regex", '"matches" wants a string and a regex'), "bool";
      return want(l === "int" && r === "int", "can only compare ints"), "bool";
    }
  }
}

/** The evaluator keeps defensive branches (a mismatch yields false); an accepted program never reaches them. */
function evaluate(n: Node, row: RuleRow): unknown {
  if (n.k === "lit") return n.v;
  if (n.k === "list") return n.items.map((it) => evaluate(it, row));
  if (n.k === "id") return row[n.name as keyof RuleRow];
  if (n.k === "un") return n.op === "not" ? !evaluate(n.x, row) : -(evaluate(n.x, row) as number);
  const l = evaluate(n.l, row);
  if (n.op === "and") return Boolean(l) && Boolean(evaluate(n.r, row));
  if (n.op === "or") return Boolean(l) || Boolean(evaluate(n.r, row));
  const r = evaluate(n.r, row);
  switch (n.op) {
    case "+": return typeof l === "string" ? l + String(r) : (l as number) + (r as number);
    case "-": return (l as number) - (r as number);
    case "==": return l === r;
    case "!=": return l !== r;
    case "<": return (l as number) < (r as number);
    case "<=": return (l as number) <= (r as number);
    case ">": return (l as number) > (r as number);
    case ">=": return (l as number) >= (r as number);
    case "contains": return Array.isArray(l) ? l.includes(r) : typeof l === "string" && l.includes(String(r));
    case "startswith": return typeof l === "string" && l.startsWith(String(r));
    case "matches": return r instanceof RegExp && typeof l === "string" && r.test(l);
    default: return false;
  }
}

export type Verdict = { ok: true; type: "bool"; run: (row: RuleRow) => boolean } | { ok: false; message: string; at: [number, number]; snippet: string };

/** The one door: editor, persisted rule, import — all of them, here. */
export function compileRule(src: string): Verdict {
  try {
    const root = parse(lex(src));
    const type = typeOf(root);
    if (type !== "bool") throw new Ill(`expected bool but got ${type}`, root.s, root.e);
    return { ok: true, type: "bool", run: (row) => evaluate(root, row) === true };
  } catch (err) {
    if (err instanceof Ill) return { ok: false, message: err.message, at: [err.s, err.e], snippet: src.slice(err.s, err.e) };
    throw err;
  }
}
