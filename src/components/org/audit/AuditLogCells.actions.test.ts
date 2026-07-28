// G6-06: the audit viewer's `ACTIONS` list is hand-maintained, separate from every route/lib call site
// that actually records an entry (`recordAudit`/`recordOrgAudit`). Two real actions (`org.gate_policy`,
// `playbook.updated`) had drifted off that list — they rendered as an unlabeled grey badge in the
// viewer AND couldn't be selected in the Action filter. A shared constant isn't practical here: the
// recorder call sites span a dozen unrelated route/lib modules with no natural common import, and
// forcing one would ripple far outside this agent's scope (src/components/org/audit/**).
//
// Instead this test IS the shared source of truth's substitute: it statically walks every .ts/.tsx file
// under src/ (excluding tests) for `recordAudit(...)` / `recordOrgAudit(...)` call sites, resolves the
// literal action string each one records (following exported `..._ACTION = "..."` constants used as the
// first argument), and fails if any resolved action has no entry in AuditLogCells' `ACTION_FILTERS`. The
// next action anyone adds to the app is caught here before it can silently fall off the viewer's list.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ACTION_FILTERS } from "./AuditLogCells";

const SRC_ROOT = path.resolve(__dirname, "../../../../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Collect every `export const FOO_ACTION = "literal"` across the codebase, for resolving call sites
 *  that pass a named constant (e.g. `recordAudit(PURGE_ACTION, ...)`) instead of an inline string. */
function collectActionConstants(files: string[]): Map<string, string> {
  const consts = new Map<string, string>();
  const re = /export const ([A-Z][A-Z0-9_]*)\s*=\s*["']([a-zA-Z0-9_.]+)["']/g;
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(re)) consts.set(m[1], m[2]);
  }
  return consts;
}

/** Every literal (or constant-resolved) action string passed as the first argument to `recordAudit(` or
 *  `recordOrgAudit(` anywhere in src/. Dynamic template-literal actions (e.g.
 *  `` `org_skill.${result.status}` ``) resolve to their static prefix, since the finite set of runtime
 *  suffixes is enumerated by hand at the call site, not discoverable statically. */
function collectRecordedActions(files: string[], consts: Map<string, string>): { literal: Set<string>; prefixes: Set<string> } {
  const literal = new Set<string>();
  const prefixes = new Set<string>();
  const callRe = /\brecord(?:Org)?Audit\(\s*([^,)]+)/g;
  for (const file of files) {
    // Skip the definitions themselves (`export async function recordAudit(action: string, ...)`),
    // which would otherwise "match" on the parameter name `action`.
    if (file.endsWith(path.join("lib", "db", "scans-audit.ts"))) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(callRe)) {
      const arg = m[1].trim();
      const strMatch = arg.match(/^["']([a-zA-Z0-9_.]+)["']$/);
      if (strMatch) {
        literal.add(strMatch[1]);
        continue;
      }
      const templateMatch = arg.match(/^`([a-zA-Z0-9_.]+)\.\$\{/);
      if (templateMatch) {
        prefixes.add(templateMatch[1]);
        continue;
      }
      const identMatch = arg.match(/^([A-Z][A-Z0-9_]*)$/);
      if (identMatch && consts.has(identMatch[1])) {
        literal.add(consts.get(identMatch[1])!);
      }
      // Any other shape (a runtime-computed non-constant expression) can't be resolved statically and
      // is intentionally not asserted on here.
    }
  }
  return { literal, prefixes };
}

describe("every recorded audit action has a viewer label (G6-06)", () => {
  const files = walk(SRC_ROOT);
  const consts = collectActionConstants(files);
  const { literal, prefixes } = collectRecordedActions(files, consts);
  const known = new Set(ACTION_FILTERS.map((f) => f.value).filter(Boolean));

  it("found a non-trivial number of recorded actions to check (sanity check on the walker itself)", () => {
    expect(literal.size).toBeGreaterThan(10);
  });

  it("has a label for org.gate_policy and playbook.updated specifically", () => {
    expect(known.has("org.gate_policy")).toBe(true);
    expect(known.has("playbook.updated")).toBe(true);
  });

  it("has a viewer label for every statically-resolvable recorded action", () => {
    const unlabeled = [...literal].filter((a) => !known.has(a)).sort();
    expect(unlabeled).toEqual([]);
  });

  it("has at least one labelled action for every dynamic (template-literal) action prefix", () => {
    const missingPrefix = [...prefixes].filter((p) => ![...known].some((k) => k.startsWith(`${p}.`))).sort();
    expect(missingPrefix).toEqual([]);
  });
});
