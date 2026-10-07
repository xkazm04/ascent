import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// GUARD: no silent catch in the repo-maturity-scan span (council r1 + r2 robustness findings).
//
// Two council rounds each found a catch that turned a failed read into a successful answer and told
// nobody — and round 2's was the next sibling of the shape round 1's rework had fixed line by line.
// This guard holds the shape across the WHOLE span instead of the named lines. The span is derived
// from context-map.json (the same four contexts the council reviews) plus the out-of-span readers the
// permalink calls, so a file added to a context is guarded the day it is added.
//
// SILENT = a catch site that reaches no door (registry: error-handling/swallowed-error-prevention):
//   - `.catch(handler)` / `.then(_, handler)` whose inline handler calls no door, does not rethrow and
//     never reads its error — which includes every `.catch(() => null | [] | {} | false | undefined |
//     EMPTY_*)` — or whose named handler is not a door;
//   - `catch {}` / `catch (e) {}`, and a catch whose body is only control flow and `return …` with no
//     door and no use of the caught error.
// A DOOR is a call to console.error / console.warn, reportHandledError, the scan-read-door helpers or
// the ingest's sensorFailed recorder — or to a function in the same file whose body reaches one.
//
// Matching is on the TypeScript AST, so a comment or a string that NAMES a door satisfies nothing
// (AGENTS.md: a source-scanning gate must not be satisfiable by prose); the seeded cases at the bottom
// prove the matcher still bites. Legitimately silent sites (class C) are on ALLOWLIST with a reason and
// an exact count per enclosing function: a new swallow beside an allowed one fails too.

const SPAN_CONTEXTS = [
  "Scan Pipeline & Ingestion",
  "Maturity Model & Scoring Engine",
  "Score Charts & Visuals",
  "Repo Report Shell & Tabs",
];
/** Out-of-span modules the permalink reads through, plus files extracted from the span by the sweep. */
const EXTRA_PATHS = [
  "src/lib/db/scans-read.ts",
  "src/lib/db/skill-history.ts",
  "src/lib/scan-read-door.ts",
  "src/app/report/[owner]/[repo]/PermalinkPanels.tsx",
  "src/app/report/[owner]/[repo]/SkillHistorySection.tsx",
  "src/app/api/history/route.ts",
  "src/app/api/report/passport/route.ts",
  "src/app/api/recommendations/route.ts",
];

const DOOR_CALLS = new Set([
  "console.error",
  "console.warn",
  "reportHandledError",
  "reportFailedRead",
  "reportDegradedRead",
  "degradeTo",
  "sensorFailed",
]);

const C_STREAM = "stream cancel: the SSE controller or reader is already closed (client gone), nothing is lost";
const C_STORAGE = "browser-storage access: a refusing store (private mode) means no rejoin, today's cold load";
const C_TELEMETRY = "fire-and-forget telemetry tally: recordQuotaEvent already swallows its own store errors";
const C_BODY = "response/request body parse: the status or the validation right after it reaches the door";
const C_REPO_INPUT = "a malformed file in the SCANNED repo is a fact about that repo, not a failed read of ours";
const C_USER_INPUT = "decoding user input: a malformed %-sequence keeps the raw value, which is the answer";

/** `file#enclosing function` → exact count of allowed silent sites, and why they are legitimate. */
const ALLOWLIST: Record<string, { count: number; reason: string }> = {
  "src/app/api/scan/route.ts#runScan": { count: 1, reason: C_TELEMETRY },
  "src/app/api/scan/route.ts#POST": { count: 1, reason: C_BODY },
  "src/app/api/scan/stream/route.ts#POST": { count: 1, reason: C_BODY },
  "src/app/api/scan/stream/route.ts#start": { count: 2, reason: C_STREAM },
  "src/app/page.tsx#Home": { count: 1, reason: C_TELEMETRY },
  "src/app/report/[owner]/[repo]/repoParam.ts#decodeSegment": { count: 1, reason: C_USER_INPUT },
  "src/components/report/FoundationPrButton.tsx#open": { count: 1, reason: C_BODY },
  "src/components/report/ReportConversionCta.tsx#trackRepo": { count: 1, reason: C_BODY },
  "src/components/report/useReportScan.ts#useReportScan": { count: 1, reason: C_BODY },
  "src/components/report/scanResume.ts#defaultScanAnchorStore": { count: 1, reason: C_STORAGE },
  "src/components/report/scanResume.ts#writeScanAnchor": { count: 1, reason: C_STORAGE },
  "src/components/report/scanResume.ts#clearScanAnchor": { count: 1, reason: C_STORAGE },
  "src/components/report/scanResume.ts#readScanAnchor": { count: 2, reason: C_STORAGE },
  "src/lib/analyze/index.ts#packageScripts": { count: 1, reason: C_REPO_INPUT },
  "src/lib/analyze/tech-extract.ts#packageDeps": { count: 1, reason: C_REPO_INPUT },
  "src/lib/analyze/tech-extract.ts#extractTechStack": { count: 1, reason: C_REPO_INPUT },
  "src/lib/cache.ts#normalizeRepoName": { count: 1, reason: C_USER_INPUT },
  "src/lib/cache.ts#coalesceScan": { count: 3, reason: "progress fan-out to a dead listener (a closed SSE controller) must not break the shared scan; the promise rejection still reaches every awaiting caller (`.then(evict, evict)` is cleanup)" },
  "src/lib/github/security-posture.ts#fetchAdvisoryCount": { count: 1, reason: "body parse whose null is rejected one line below by a throw into the ingest's sensorFailed door" },
  "src/lib/scan-gates.ts#scanRateLimitGate": { count: 1, reason: C_TELEMETRY },
  "src/lib/sse-server.ts#makeSseSend": { count: 1, reason: C_STREAM },
  "src/lib/sse.ts#readSSE": { count: 1, reason: `${C_STREAM}; the original error is rethrown` },
};

type Site = { file: string; line: number; owner: string; text: string };

function spanSources(): string[] {
  const map = JSON.parse(readFileSync(join(process.cwd(), "context-map.json"), "utf8")) as {
    groups: { contexts?: { name: string; filePaths: string[] }[] }[];
  };
  const contexts = map.groups.flatMap((g) => g.contexts ?? []);
  const paths = new Set(EXTRA_PATHS);
  for (const name of SPAN_CONTEXTS) {
    const ctx = contexts.find((c) => c.name === name);
    if (!ctx) throw new Error(`context-map.json has no context named "${name}" — the guard's span would silently shrink`);
    for (const p of ctx.filePaths) paths.add(p);
  }
  return [...paths].filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.endsWith(".d.ts")).sort();
}

function calleeName(expr: ts.Expression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return `${calleeName(expr.expression)}.${expr.name.text}`;
  return "";
}

/** Find every silent catch site in one source text. */
export function findSilentCatches(file: string, text: string): Site[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  // Local functions by name, so a file's own door helper (`reportDegraded`, `peekBodyUnreadable`) counts.
  const localFns = new Map<string, ts.Node>();
  const collect = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name) localFns.set(n.name.text, n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
      localFns.set(n.name.text, n.initializer);
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);

  const isDoorName = (name: string, seen: Set<string>): boolean => {
    if (DOOR_CALLS.has(name)) return true;
    const fn = localFns.get(name);
    if (!fn || seen.has(name)) return false;
    seen.add(name);
    return reachesDoor(fn, seen);
  };
  function reachesDoor(node: ts.Node, seen = new Set<string>()): boolean {
    let found = false;
    const walk = (n: ts.Node) => {
      if (found) return;
      if (ts.isThrowStatement(n)) found = true;
      else if (ts.isCallExpression(n) && isDoorName(calleeName(n.expression), seen)) found = true;
      else ts.forEachChild(n, walk);
    };
    walk(node);
    return found;
  }
  const readsIdentifier = (node: ts.Node, name: string): boolean => {
    let hit = false;
    const walk = (n: ts.Node) => {
      if (hit) return;
      if (ts.isIdentifier(n) && n.text === name) hit = true;
      else ts.forEachChild(n, walk);
    };
    walk(node);
    return hit;
  };
  /** A catch body made only of control flow: empty, `return …`, or `if (…) return;`. */
  const controlFlowOnly = (s: ts.Statement): boolean =>
    ts.isReturnStatement(s) || ts.isEmptyStatement(s) ||
    (ts.isBlock(s) && s.statements.every(controlFlowOnly)) ||
    (ts.isIfStatement(s) && controlFlowOnly(s.thenStatement) && (!s.elseStatement || controlFlowOnly(s.elseStatement)));

  const silentHandler = (h: ts.Expression): boolean => {
    if (ts.isArrowFunction(h) || ts.isFunctionExpression(h)) {
      const param = h.parameters[0]?.name;
      const usesErr = param !== undefined && ts.isIdentifier(param) && readsIdentifier(h.body, param.text);
      return !usesErr && !reachesDoor(h.body);
    }
    const name = ts.isCallExpression(h) ? calleeName(h.expression) : calleeName(h);
    return !isDoorName(name, new Set());
  };

  const sites: Site[] = [];
  /** The nearest NAMED enclosing function — the allowlist's stable address (a line number is not). */
  const owner = (n: ts.Node): string => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText(sf);
      if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) {
        return p.parent.name.text;
      }
    }
    return "<module>";
  };
  const add = (n: ts.Node) => {
    const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    sites.push({ file, line: line + 1, owner: owner(n), text: n.getText(sf).replace(/\s+/g, " ").slice(0, 120) });
  };
  const visit = (n: ts.Node) => {
    if (ts.isCatchClause(n)) {
      const binding = n.variableDeclaration?.name;
      const usesErr = binding !== undefined && ts.isIdentifier(binding) && readsIdentifier(n.block, binding.text);
      if (!usesErr && !reachesDoor(n.block) && n.block.statements.every(controlFlowOnly)) add(n);
    } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      const handler = method === "catch" ? n.arguments[0] : method === "then" ? n.arguments[1] : undefined;
      if (handler && silentHandler(handler)) add(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return sites;
}

describe("scan span: no silent catch (guard)", () => {
  const files = spanSources();
  const sites = files.flatMap((f) => findSilentCatches(f, readFileSync(join(process.cwd(), f), "utf8")));

  it("derives a real span from context-map.json (not vacuously empty)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("src/app/report/[owner]/[repo]/page.tsx");
    expect(files).toContain("src/lib/scan-ingest.ts");
  });

  it("every silent catch is an allowlisted, reasoned class-C site — and no allowlist entry is stale", () => {
    const byKey = new Map<string, Site[]>();
    for (const s of sites) byKey.set(`${s.file}#${s.owner}`, [...(byKey.get(`${s.file}#${s.owner}`) ?? []), s]);
    const problems: string[] = [];
    for (const [key, found] of byKey) {
      const allowed = ALLOWLIST[key]?.count ?? 0;
      if (found.length > allowed) {
        problems.push(
          `${key}: ${found.length} silent catch(es), ${allowed} allowed — add a door (src/lib/scan-read-door.ts) or, if legitimately silent, an ALLOWLIST entry with a reason:\n` +
            found.map((s) => `    ${s.file}:${s.line}  ${s.text}`).join("\n"),
        );
      }
    }
    for (const [key, { count }] of Object.entries(ALLOWLIST)) {
      const found = byKey.get(key)?.length ?? 0;
      if (found < count) problems.push(`${key}: ALLOWLIST expects ${count}, found ${found} — shrink the entry (the ratchet only goes down)`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("every allowlist entry carries a reason", () => {
    for (const [key, { reason }] of Object.entries(ALLOWLIST)) expect(reason.length, key).toBeGreaterThan(20);
  });
});

describe("the matcher still bites (seeded violations)", () => {
  const silent = (src: string) => findSilentCatches("seed.ts", src).length;

  it.each([
    ["p.catch(() => null)"],
    ["p.catch(() => [])"],
    ["p.catch(() => ({}))"],
    ["p.catch(() => {})"],
    ["p.catch(() => false)"],
    ["p.catch(() => undefined)"],
    ["p.catch(() => EMPTY_LIFTS)"],
    ["p.catch(() => paths.map((path) => ({ path })))"],
    ["p.then(ok, () => null)"],
    ["try { f(); } catch {}"],
    ["try { f(); } catch (e) { return null; }"],
    ["function g() { try { f(); } catch { if (x) return; } }"],
    ["try { f(); } catch (e) { /* console.warn(e); reportHandledError(e) */ return null; }"],
    ['p.catch(() => "console.warn")'],
    ["p.catch(noop)"],
  ])("flags %s", (src) => {
    expect(silent(src)).toBe(1);
  });

  it.each([
    ["p.catch((err) => { console.warn(err); return null; })"],
    ['p.catch(degradeTo("read", null))'],
    ['p.catch(sensorFailed("ciHealth", null))'],
    ["try { f(); } catch (e) { reportHandledError(e, { message: 'x' }); return null; }"],
    ["try { f(); } catch (e) { throw new Error('wrapped', { cause: e }); }"],
    ["try { f(); } catch (e) { return { error: e }; }"],
    ["function door(e) { console.error(e); } try { f(); } catch (e) { door(e); return null; }"],
    ["const warnMiss = (w) => (e) => { console.warn(w, e); return null; }; p.catch(warnMiss('peek'))"],
    ['try { f(); } catch { setState({ phase: "error" }); }'],
  ])("passes %s", (src) => {
    expect(silent(src)).toBe(0);
  });
});
