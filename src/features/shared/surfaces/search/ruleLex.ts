// typed-filter-language, the lexer half: source text to a token stream ending in an `end` sentinel.
// `Ill` is the one error the whole pipeline (lex, parse, type) throws — it carries the offending span.
// Extracted from rules.ts so the parser/typer file stays under the features LOC cap. No React.

export class Ill extends Error {
  constructor(message: string, public s: number, public e: number) {
    super(message);
  }
}
export type Tok = { k: "num" | "str" | "re" | "id" | "op" | "end"; t: string; s: number; e: number };
const LEX = /\s*(?:(\d+)|("(?:[^"\\]|\\.)*")|(\/(?:[^/\\]|\\.)+\/)|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|[<>+\-(),[\]]))/y;

export function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let at = 0;
  while (at < src.length) {
    LEX.lastIndex = at;
    const m = LEX.exec(src);
    if (!m || m[0].length === 0) {
      if (/^\s*$/.test(src.slice(at))) break;
      const bad = src.slice(at).search(/\S/) + at;
      throw new Ill(`unexpected character "${src.charAt(bad)}"`, bad, bad + 1);
    }
    // A non-empty match always fills exactly one alternative; the trimmed whole match is the same text.
    const t = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[0].trim();
    const s = at + m[0].length - t.length;
    out.push({ k: m[1] ? "num" : m[2] ? "str" : m[3] ? "re" : m[4] ? "id" : "op", t, s, e: at + m[0].length });
    at = LEX.lastIndex;
  }
  out.push({ k: "end", t: "", s: src.length, e: src.length });
  return out;
}
