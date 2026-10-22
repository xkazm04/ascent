// @vitest-environment node
//
// ONE AUDIT-LEDGER WRITE DOOR. Every audit writer used to hand-build the signed row (stamp `at`, call
// withAuditSignature, stringify, create), and four of those copies were found UNSIGNED one at a time
// and fixed one at a time. src/lib/db/audit-append.ts now owns the envelope. This guard keeps it that
// way: no non-test file under src/ other than the door may CALL auditLog.create / createMany / update /
// updateMany / upsert, and auditLog.deleteMany (the retention purge) may appear only in retention.ts.
//
// Comments and string literals are stripped before matching (a write named only in prose must not
// count), and a seeded violation proves the matcher still bites, because a matcher that stops
// matching reports a clean tree in a voice indistinguishable from success.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = join(process.cwd(), "src");
const DOOR = "src/lib/db/audit-append.ts";
const PURGE_HOME = "src/lib/db/retention.ts";
const WRITE = /\bauditLog\s*\.\s*(create|createMany|update|updateMany|upsert)\s*\(/g;
const DELETE = /\bauditLog\s*\.\s*(delete|deleteMany)\s*\(/g;

/** Drop comments and string/template literals, walking the source once (same scanner shape as
 *  src/lib/alert-door.contract.test.ts). */
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

function calls(src: string, re: RegExp): string[] {
  return [...stripCommentsAndStrings(src).matchAll(re)].map((m) => m[1]!);
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

function scan(re: RegExp, allowed: string): string[] {
  const offenders: string[] = [];
  const files = sourceFiles(SRC);
  expect(files.length).toBeGreaterThan(100); // the walker found the tree
  for (const file of files) {
    const rel = relative(process.cwd(), file).split(sep).join("/");
    if (rel === allowed) continue;
    for (const name of calls(readFileSync(file, "utf8"), re)) offenders.push(`${rel}: auditLog.${name}(`);
  }
  return offenders;
}

describe("the audit-append door is the only audit-ledger writer", () => {
  it("no non-test file outside the door calls auditLog.create/createMany/update/updateMany/upsert", () => {
    expect(scan(WRITE, DOOR)).toEqual([]);
  });

  it("auditLog.delete/deleteMany appears only in the retention purge", () => {
    expect(scan(DELETE, PURGE_HOME)).toEqual([]);
  });

  it("the door itself is seen writing (the matcher reads real call sites)", () => {
    const door = calls(readFileSync(join(SRC, "lib", "db", "audit-append.ts"), "utf8"), WRITE);
    expect(door).toEqual(expect.arrayContaining(["create", "createMany", "update"]));
  });

  it("seeded violation: a real call is flagged; the same text in a comment or string is not", () => {
    const seeded = [
      "// await tx.auditLog.create({ data })",
      "/* await tx.auditLog.update({ data }) */",
      'const s = "await tx.auditLog.create({ data })";',
      "const t = `await tx.auditLog.createMany({ data })`;",
      "await tx.auditLog.findMany({ where });",
      "await tx.auditLog.create({ data });",
      "await prisma.auditLog .upsert({ where, create, update });",
    ].join("\n");
    expect(calls(seeded, WRITE)).toEqual(["create", "upsert"]);
    expect(calls("await prisma.auditLog.deleteMany({ where });", DELETE)).toEqual(["deleteMany"]);
  });
});
