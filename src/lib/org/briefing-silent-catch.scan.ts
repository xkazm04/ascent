// A small source scanner for the silent-catch guard (briefing-silent-catch.guard.test.ts). It reads
// CODE, not prose: comments, string contents and regex literals are blanked first, so a comment that
// merely describes a door cannot satisfy it and a quote inside a regex cannot derail the scan.

export type SilentShape = "catch-literal" | "empty-catch" | "catch-return";
export interface Site {
  shape: SilentShape;
  line: number;
  text: string;
}

const DOOR = /\b(console\.|noteReadFailure|reportHandledError|respondError|degradedRead|throw\b)/;

/** Same-length copy of `src` with comments, string/template contents and regex literals blanked. */
export function blankNonCode(src: string): string {
  const out: string[] = [];
  const keep = (c: string) => (c === "\n" ? "\n" : " ");
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") {
        out.push(" ");
        i++;
      }
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) out.push(keep(src[i]!));
    } else if (c === '"' || c === "'" || c === "`") {
      out.push(c);
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") {
          out.push(" ");
          i++;
        }
        if (i < src.length) {
          out.push(keep(src[i]!));
          i++;
        }
      }
      out.push(c);
      i++;
    } else if (c === "/" && regexAllowed(out)) {
      // A regex literal (a `/` where an operand is expected): skip to the closing slash, honouring classes.
      out.push(c);
      i++;
      let inClass = false;
      while (i < src.length && src[i] !== "\n" && (inClass || src[i] !== "/")) {
        if (src[i] === "\\") {
          out.push(" ");
          i++;
        } else if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        out.push(" ");
        i++;
      }
      out.push("/");
      i++;
    } else {
      out.push(c);
      i++;
    }
  }
  return out.join("");
}

/** A `/` begins a regex literal (not a division) when the code before it expects an operand. */
function regexAllowed(out: string[]): boolean {
  const tail = out.slice(-40).join("").trimEnd();
  return tail === "" || /[(,=:[!&|?{};>+\-*%<~^]$/.test(tail) || /\b(return|typeof|case|in|of|else|do|void|delete|throw|yield|await)$/.test(tail);
}

const lineOf = (code: string, idx: number) => code.slice(0, idx).split("\n").length;

/** Every silent catch shape in `src`: a `.catch` handler that answers a literal, an empty `catch`, or a
 *  `catch` whose whole body is one `return` with no door. */
export function findSilentCatches(src: string): Site[] {
  const code = blankNonCode(src);
  const raw = src.split("\n");
  const sites: Site[] = [];
  const push = (shape: SilentShape, idx: number) => {
    const line = lineOf(code, idx);
    sites.push({ shape, line, text: (raw[line - 1] ?? "").trim() });
  };

  const literal = /\.catch\(\s*(?:\([^)]*\)|\w+)\s*=>\s*(?:null\b|undefined\b|false\b|true\b|\d|\[|\{\s*\}|\(\s*\{|new\s|["'`])/g;
  for (let m = literal.exec(code); m; m = literal.exec(code)) push("catch-literal", m.index);

  const block = /(?<![.\w])catch\s*(?:\([^)]*\))?\s*\{/g;
  for (let m = block.exec(code); m; m = block.exec(code)) {
    let depth = 1;
    let j = m.index + m[0].length;
    const start = j;
    for (; j < code.length && depth > 0; j++) {
      if (code[j] === "{") depth++;
      else if (code[j] === "}") depth--;
    }
    // Decided on the blanked body: a door named only in a comment or string is not a door.
    const body = code.slice(start, j - 1).trim();
    if (body === "") push("empty-catch", m.index);
    else if (/^return\b[^;{}]*;?$/.test(body) && !DOOR.test(body)) push("catch-return", m.index);
  }
  return sites;
}
