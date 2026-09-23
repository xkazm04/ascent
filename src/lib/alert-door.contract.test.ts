// @vitest-environment node
//
// ONE ALERT DELIVERY DOOR. Every alert kind used to hand-write the same five steps (read the sink,
// resolve it, claim a slot, dispatch, record the history row), and the copies diverged in the one way
// that mattered: two of them swallowed a failed sink read into null, which the resolver treats as
// "use the operator's global sink". src/lib/alert-door.ts now owns the sequence. This guard keeps it
// that way: no non-test file under src/ other than the door and the transport itself may CALL
// dispatchAlert( or recordAlertEvent(.
//
// Comments and string literals are stripped before matching (a call named only in prose must not
// count, and an explanation of the rule must not trip it), and a seeded violation proves the matcher
// still bites, because a matcher that stops matching reports a clean tree in a voice
// indistinguishable from success.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = join(process.cwd(), "src");
const ALLOWED = new Set(["src/lib/alert-door.ts", "src/lib/alert-delivery.ts"]);
const CALL = /(?<!function\s)(?<!\w)(dispatchAlert|recordAlertEvent)\s*\(/g;

/** Drop comments and string/template literals, walking the source once (same scanner shape as
 *  src/app/api/org/id-routes-gated.test.ts). A template's `${...}` is dropped with it: crude in the
 *  safe direction for this repo, where no call site hides inside an interpolation. */
function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Every call of the two guarded functions in `src`, after stripping. */
function doorBypasses(src: string): string[] {
  return [...stripCommentsAndStrings(src).matchAll(CALL)].map((m) => m[1]!);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "node_modules") sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("the alert delivery door is the only caller of dispatch + record", () => {
  it("no non-test file outside the door calls dispatchAlert( or recordAlertEvent(", () => {
    const offenders: string[] = [];
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(100); // the walker found the tree
    for (const file of files) {
      const rel = relative(process.cwd(), file).split(sep).join("/");
      if (ALLOWED.has(rel)) continue;
      for (const name of doorBypasses(readFileSync(file, "utf8"))) offenders.push(`${rel}: ${name}(`);
    }
    expect(offenders).toEqual([]);
  });

  it("the door itself is seen calling both (the matcher reads real call sites)", () => {
    const door = doorBypasses(readFileSync(join(SRC, "lib", "alert-door.ts"), "utf8"));
    expect(door).toContain("dispatchAlert");
    expect(door).toContain("recordAlertEvent");
  });

  it("seeded violation: a bare or member call is reported; prose, strings, definitions and look-alikes are not", () => {
    const seeded = [
      "// dispatchAlert(message) in a comment",
      'const s = "recordAlertEvent(org, row)";',
      "export async function recordAlertEvent(org: string) {}",
      "const mydispatchAlert = (x: number) => x; mydispatchAlert(1);",
      "alerts.recordAlertEvent(org, row);",
      "await dispatchAlert(message, { webhookUrl, org });",
    ].join("\n");
    expect(doorBypasses(seeded)).toEqual(["recordAlertEvent", "dispatchAlert"]);
  });
});
