// The guidance ARBITER (moonshot #15) — one graph over every vendor's agent-instruction format.
//
// THE PROBLEM. Five vendors, five files, one repository. `CLAUDE.md`, `AGENTS.md`, `.cursorrules`,
// `.github/copilot-instructions.md` and `.windsurfrules` all address the same audience about the same
// codebase, and nothing in the ecosystem reads them against each other — every vendor scorer favours
// its own format. The old D1 detector summed their PRESENCE (22 + 16 + 14 + 14 + 10 = 76 before
// quality), so four copies that contradict each other outscored one document that is actually true.
// That is the inversion this module exists to remove: a repo where an agent gets a different answer
// depending on which file it opened is WORSE off than a repo with one answer, not better.
//
// WHAT IT PRODUCES. A `GuidanceGraph`: the documents as nodes, their relationships as edges, a
// nominated canonical source with the BASIS for that nomination, the contradictions found between
// them, and a deterministic `coherence` number every point of which is itemized in `penalties[]`.
// A reader can always re-trace the number to the two file paths it was read from — the property Sam's
// automatic-trust-failure clause ("a score I cannot re-trace") is written about.
//
// WHAT IT DELIBERATELY DOES NOT DO. It never subtracts from a score. Under r11 the coherence number
// only decides how much of an 18-point bonus D1 AWARDS (guardrail G4/G5: no new lever that lowers a
// score on a heuristic). A contradiction withholds points; it never fires an alert and never fails a
// gate. And `coherence` is `null` — never 0 — for a repo with no guidance document, because 0 is a
// verdict and "we found nothing to assess" is not one.
//
// Pure and dependency-free apart from `node:crypto` (via guidance-projection), so every rule below is
// unit-testable without a model, a network or a database.

import type {
  GuidanceAgent,
  GuidanceContradiction,
  GuidanceEdge,
  GuidanceGraph,
  GuidanceNode,
  RepoSnapshot,
} from "@/lib/types";
import { GUIDANCE_PATH_RE } from "@/lib/analyze/context-health";
import { parseProjectionHeader, projectionState, sha12 } from "@/lib/analyze/guidance-projection";

/** Quote bound, mirroring CLAIM_QUOTE_MAX — no guidance body is ever mirrored wholesale into the DB. */
export const GUIDANCE_QUOTE_MAX = 200;

/** Multi-file rules directories the single-file `GUIDANCE_PATH_RE` (freshness-budgeted) excludes. */
const EXTRA_GUIDANCE_RE = /^(\.cursor\/rules\/.+\.mdc?|\.windsurf\/rules\/.+\.mdc?|\.github\/instructions\/.+\.md)$/i;

/** Every path this build treats as an instruction DOCUMENT (not a tool config — `.aider.conf.yml` is
 *  a config and stays a plain D1 presence award, because it is not a competing copy of the document). */
export function isGuidancePath(path: string): boolean {
  return GUIDANCE_PATH_RE.test(path) || EXTRA_GUIDANCE_RE.test(path);
}

export function guidanceAgentOf(path: string): GuidanceAgent {
  const p = path.toLowerCase();
  const base = p.replace(/^.*\//, "");
  if (base === "claude.md") return "claude";
  if (base === "agents.md" || base === "agent.md") return "agents";
  if (base === ".cursorrules" || p.startsWith(".cursor/")) return "cursor";
  if (p.startsWith(".github/copilot-instructions") || p.startsWith(".github/instructions/")) return "copilot";
  if (base === ".windsurfrules" || p.startsWith(".windsurf/")) return "windsurf";
  if (base === ".aider.conf.yml" || base === ".aider.conf.yaml") return "aider";
  return "other";
}

/** Display rank only — which document an agent reads first. NEVER used to nominate a canonical source
 *  (that would invent a verdict); used to pick which node's text D1 grades when nothing was nominated,
 *  and to order the node list deterministically. */
export function guidanceRankOf(path: string): number {
  const a = guidanceAgentOf(path);
  const order: GuidanceAgent[] = ["claude", "agents", "cursor", "copilot", "windsurf", "aider", "other"];
  const i = order.indexOf(a);
  return (i < 0 ? order.length : i) + path.split("/").length * 10;
}

// ---- body parsing ------------------------------------------------------------------------------

const clip = (s: string): string => s.replace(/\s+/g, " ").trim().slice(0, GUIDANCE_QUOTE_MAX);

/** Command shapes any build system produces. Deliberately a list of RUNNERS, not of tools: the key is
 *  derived from the verb, so `npm test`, `pytest -q` and `cargo test` all normalize to "test". */
const COMMAND_RE =
  /\b((?:npm|pnpm|yarn|bun|npx)\s+(?:run\s+)?[\w:@./-]+|make\s+[\w:./-]+|pytest\b[^\n`]{0,40}|go\s+(?:test|build|vet)\b[^\n`]{0,40}|cargo\s+(?:test|build|check|fmt|clippy)\b[^\n`]{0,40}|mvn\s+[\w:.-]+|gradle\s+[\w:.-]+|poetry\s+run\s+[\w:.-]+|dotnet\s+(?:test|build)\b)/g;

/** Verb → capability key. First match wins, so `npm run test:build` keys on "test" deterministically. */
const COMMAND_KEYS: readonly [RegExp, string][] = [
  [/\b(test|pytest|vitest|jest|spec)\b/, "test"],
  [/\b(lint|clippy|eslint|ruff|flake8)\b/, "lint"],
  [/\b(typecheck|tsc|vet|mypy|check)\b/, "typecheck"],
  [/\b(fmt|format|prettier)\b/, "format"],
  [/\b(build|compile|package)\b/, "build"],
  [/\b(dev|start|serve|watch)\b/, "dev"],
  [/\b(install|ci|sync)\b/, "install"],
];

function commandKey(command: string): string | null {
  const c = command.toLowerCase();
  for (const [re, key] of COMMAND_KEYS) if (re.test(c)) return key;
  return null;
}

/** One literal command per capability key, first occurrence wins — a document that states `npm test`
 *  in its Commands section and again in an example has ONE test command, not two. */
export function parseCommands(text: string): { key: string; command: string }[] {
  const out: { key: string; command: string }[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(COMMAND_RE)) {
    const command = (m[1] ?? "").replace(/[\s.,;:)`'"]+$/, "").trim();
    const key = commandKey(command);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, command });
  }
  return out;
}

const NEVER_RE = /\b(never|do not|don't|must not|avoid|no longer)\b/i;
const ALWAYS_RE = /\b(always|must|required|you must|should always)\b/i;

/** Words that carry no discriminating meaning in a rule subject — dropping them is what lets
 *  "never commit secrets to the repo" and "always commit secrets" collide on the same subject. */
const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "for", "and", "or", "is", "are", "be", "you", "your",
  "we", "our", "it", "this", "that", "any", "all", "into", "with", "from", "at", "by", "as", "use",
  "using", "when", "if", "then", "do", "does", "not", "never", "always", "must", "should", "avoid",
  "dont", "don", "t", "no", "longer", "required", "please", "make", "sure",
]);

/** The comparable core of a rule: up to four significant tokens after the polarity word. Two rules
 *  with the same subject and opposite polarity are a deterministic contradiction. */
export function ruleSubject(line: string): string | null {
  const tokens = line
    .toLowerCase()
    .replace(/[`*_#>[\]()]/g, " ")
    .replace(/[^a-z0-9\s/.-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  const core = tokens.slice(0, 4);
  return core.length >= 2 ? core.join(" ") : null;
}

/** Rule lines: an imperative with a polarity. A line carrying BOTH polarities ("never do X, always do
 *  Y") is ambiguous to a token-level reader, so it is skipped rather than guessed at. */
export function parseRules(text: string): { subject: string; polarity: "never" | "always"; quote: string }[] {
  const out: { subject: string; polarity: "never" | "always"; quote: string }[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length < 8 || line.length > 400) continue;
    const neg = NEVER_RE.test(line);
    const pos = ALWAYS_RE.test(line);
    if (neg === pos) continue;
    const subject = ruleSubject(line.replace(NEVER_RE, " ").replace(ALWAYS_RE, " "));
    if (!subject || seen.has(subject)) continue;
    seen.add(subject);
    out.push({ subject, polarity: neg ? "never" : "always", quote: clip(line) });
  }
  return out;
}

const POINTER_RE = /@([\w./-]+\.[a-z0-9]{1,5})|\]\(([^)\s#]+)\)/gi;

/** `@ref` and markdown-link targets, kept only when they RESOLVE against the real tree — an unresolved
 *  reference is drift (context-health's job), not a pointer that could nominate a canonical source. */
export function parsePointers(text: string, treePaths: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(POINTER_RE)) {
    const raw = (m[1] ?? m[2] ?? "").replace(/^\.\//, "").trim();
    if (!raw || /^[a-z]+:/i.test(raw)) continue;
    const hit = [...treePaths].find((p) => p.toLowerCase() === raw.toLowerCase() || p.toLowerCase().endsWith("/" + raw.toLowerCase()));
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/** A document whose body is nothing but pointers — this repo's `CLAUDE.md`, which is the single line
 *  `@AGENTS.md`. It is the strongest possible statement that the authority lives elsewhere, and the
 *  old detector could not see it: it awarded 22 for the file and then GRADED that one line. */
export function isPointerOnly(text: string, pointers: readonly string[]): boolean {
  if (pointers.length === 0) return false;
  let rest = text;
  for (const p of pointers) rest = rest.split(p).join(" ");
  const meaningful = rest.replace(/[@#>*_\-`[\]()!.:\s]/g, "");
  return meaningful.length <= 24;
}

// ---- the graph ---------------------------------------------------------------------------------

/** Deduction sizes. Named constants so the doc, the tests and the code cite ONE number each. */
export const PENALTY = {
  divergentCommand: 25,
  divergentCommandCap: 50,
  contradictoryRule: 15,
  contradictoryRuleCap: 30,
  noCanonical: 10,
  staleProjection: 10,
} as const;

export interface BuildGuidanceGraphOptions {
  /** Per-path last-commit ISO strings (the Context Health freshness lookups), when available. */
  lastCommitAt?: Readonly<Record<string, string | undefined>>;
}

/**
 * `guidance.canonical` as the repo itself declares it in `.ai/manifest.yaml`.
 *
 * Read with a local regex rather than through `ManifestReadout` on purpose: the graph is built during
 * signal extraction, BEFORE the readout is composed, and this module must stay pure over the snapshot
 * so the same commit always yields the same graph. One key, two lines of parsing — the readout stays
 * the authority on everything else the manifest says.
 */
export function declaredCanonical(manifestYaml: string | null | undefined): string | null {
  if (!manifestYaml) return null;
  const block = manifestYaml.split(/\r?\nguidance:\r?\n/)[1];
  if (!block) return null;
  const m = /^[ \t]+canonical:[ \t]*(.+)$/m.exec(block.split(/\r?\n[^\s#]/)[0] ?? "");
  return m ? (m[1] ?? "").trim().replace(/^["']|["']$/g, "") || null : null;
}

/**
 * Build the graph for one snapshot. Deterministic: same snapshot in, byte-identical graph out.
 *
 * Unsampled nodes (the fetch budget stops at 6 guidance files) are included as presence with
 * `contentSampled: false` and are excluded from every comparison — a repo is never penalized for a
 * file this scan chose not to read.
 */
export function buildGuidanceGraph(snap: RepoSnapshot, opts: BuildGuidanceGraphOptions = {}): GuidanceGraph {
  const treePaths = new Set(snap.tree.filter((t) => t.type === "blob").map((t) => t.path));
  const contentByPath = new Map(snap.files.map((f) => [f.path.toLowerCase(), f.content]));
  const sizeByPath = new Map(snap.tree.map((t) => [t.path, t.size]));

  const paths = [...treePaths].filter(isGuidancePath).sort((a, b) => guidanceRankOf(a) - guidanceRankOf(b) || a.localeCompare(b));

  const nodes: GuidanceNode[] = paths.map((path) => {
    const content = contentByPath.get(path.toLowerCase());
    const sampled = content != null;
    const pointers = sampled ? parsePointers(content, treePaths).filter((p) => p !== path) : [];
    return {
      path,
      agent: guidanceAgentOf(path),
      bytes: sampled ? content.length : (sizeByPath.get(path) ?? null),
      contentSampled: sampled,
      commands: sampled ? parseCommands(content) : [],
      rules: sampled ? parseRules(content) : [],
      pointers,
      pointerOnly: sampled ? isPointerOnly(content, pointers) : false,
      lastCommitAt: opts.lastCommitAt?.[path] ?? null,
    };
  });

  const byPath = new Map(nodes.map((n) => [n.path, n]));
  const sampled = nodes.filter((n) => n.contentSampled);
  const bodyOf = (n: GuidanceNode): string => contentByPath.get(n.path.toLowerCase()) ?? "";

  const edges: GuidanceEdge[] = [];
  const penalties: GuidanceGraph["penalties"] = [];
  const contradictions: GuidanceContradiction[] = [];

  // points-to — a pointer that resolves to another guidance document.
  for (const n of nodes)
    for (const p of n.pointers)
      if (byPath.has(p)) edges.push({ from: n.path, to: p, kind: "points-to", detail: n.pointerOnly ? "body is only this pointer" : "references" });

  // projects-from — a generated-from header naming a source. Its state also drives the stale penalty.
  const staleProjections: string[] = [];
  for (const n of sampled) {
    const header = parseProjectionHeader(bodyOf(n));
    if (!header) continue;
    const src = byPath.get(header.sourcePath);
    const srcBody = src && src.contentSampled ? bodyOf(src) : null;
    const resolved = projectionState(bodyOf(n), srcBody);
    edges.push({ from: n.path, to: header.sourcePath, kind: "projects-from", detail: resolved.state });
    if (resolved.state === "stale" || resolved.state === "hand-edited") staleProjections.push(n.path);
  }

  // duplicates — byte-identical bodies. Two in-sync copies are not a divergence; the edge records that
  // they agree, which is what keeps four in-sync projections at coherence 100.
  for (let i = 0; i < sampled.length; i++)
    for (let j = i + 1; j < sampled.length; j++) {
      const x = sampled[i];
      const y = sampled[j];
      if (x && y && sha12(bodyOf(x)) === sha12(bodyOf(y)))
        edges.push({ from: x.path, to: y.path, kind: "duplicates", detail: "identical body" });
    }

  // diverges — the same capability key with a different literal command. THE headline failure mode:
  // an agent that read the wrong file runs the wrong build.
  const divergentKeys: string[] = [];
  const keys = new Set(sampled.flatMap((n) => n.commands.map((c) => c.key)));
  for (const key of [...keys].sort()) {
    const stated = sampled
      .map((n) => ({ n, c: n.commands.find((c) => c.key === key) }))
      .filter((x): x is { n: GuidanceNode; c: { key: string; command: string } } => !!x.c);
    const distinct = new Set(stated.map((x) => x.c.command.toLowerCase()));
    const a = stated[0];
    const b = stated[1];
    if (!a || !b || distinct.size < 2) continue;
    divergentKeys.push(key);
    edges.push({ from: a.n.path, to: b.n.path, kind: "diverges", detail: `${key}: "${a.c.command}" vs "${b.c.command}"` });
    contradictions.push({
      kind: "command",
      subject: key,
      a: { path: a.n.path, quote: clip(a.c.command) },
      b: { path: b.n.path, quote: clip(b.c.command) },
      confidence: "deterministic",
    });
  }

  // Contradictory rule pairs — the same subject, opposite polarity, different documents.
  const rulePairs: string[][] = [];
  const subjects = new Set(sampled.flatMap((n) => n.rules.map((r) => r.subject)));
  for (const subject of [...subjects].sort()) {
    const held = sampled
      .map((n) => ({ n, r: n.rules.find((r) => r.subject === subject) }))
      .filter((x): x is { n: GuidanceNode; r: { subject: string; polarity: "never" | "always"; quote: string } } => !!x.r);
    const a = held.find((x) => x.r.polarity === "never");
    const b = held.find((x) => x.r.polarity === "always");
    if (!a || !b || a.n.path === b.n.path) continue;
    rulePairs.push([a.n.path, b.n.path]);
    edges.push({ from: a.n.path, to: b.n.path, kind: "diverges", detail: `rule "${subject}": never vs always` });
    contradictions.push({
      kind: "rule",
      subject,
      a: { path: a.n.path, quote: a.r.quote },
      b: { path: b.n.path, quote: b.r.quote },
      confidence: "deterministic",
    });
  }

  // ---- canonical nomination, first match wins ----
  let canonical: string | null = null;
  let canonicalBasis: GuidanceGraph["canonicalBasis"] = null;

  const declared = declaredCanonical(
    contentByPath.get(".ai/manifest.yaml") ?? contentByPath.get(".ai/manifest.yml"),
  );
  if (declared && byPath.has(declared)) {
    canonical = declared;
    canonicalBasis = "manifest";
  }
  if (!canonical && nodes.length > 0) {
    // (2) the unique node every OTHER node points at, where the pointing nodes are pointer-only.
    const pointing = nodes.filter((n) => n.pointerOnly);
    const targets = new Set(pointing.flatMap((n) => n.pointers.filter((p) => byPath.has(p))));
    if (pointing.length > 0 && targets.size === 1) {
      const target = [...targets][0] ?? "";
      if (target && nodes.every((n) => n.path === target || n.pointerOnly)) {
        canonical = target;
        canonicalBasis = "pointer";
      }
    }
  }
  if (!canonical) {
    // (3) the source named by ≥1 valid projects-from header, when they all name the same one.
    const named = new Set(edges.filter((e) => e.kind === "projects-from" && e.detail !== "hand-edited").map((e) => e.to));
    const only = [...named][0];
    if (named.size === 1 && only && byPath.has(only)) {
      canonical = only;
      canonicalBasis = "projection-header";
    }
  }
  if (!canonical && nodes.length === 1) {
    // A single document is trivially the authority — there is no arbitration to make, so this is not
    // rank inventing a verdict. With ≥2 documents and no nomination the answer stays null.
    canonical = nodes[0]!.path;
    canonicalBasis = "rank";
  }

  // ---- coherence ----
  let coherence: number | null = null;
  if (nodes.length > 0) {
    let deduct = 0;
    if (divergentKeys.length) {
      const points = Math.min(PENALTY.divergentCommandCap, divergentKeys.length * PENALTY.divergentCommand);
      deduct += points;
      penalties.push({
        reason: `Guidance files state different commands for: ${divergentKeys.join(", ")}`,
        points,
        paths: [...new Set(contradictions.filter((c) => c.kind === "command").flatMap((c) => [c.a.path, c.b.path]))],
      });
    }
    if (rulePairs.length) {
      const points = Math.min(PENALTY.contradictoryRuleCap, rulePairs.length * PENALTY.contradictoryRule);
      deduct += points;
      penalties.push({
        reason: `${rulePairs.length} contradictory rule pair(s) between guidance files`,
        points,
        paths: [...new Set(rulePairs.flat())],
      });
    }
    if (nodes.length >= 2 && !canonical) {
      deduct += PENALTY.noCanonical;
      penalties.push({
        reason: "No canonical guidance source is nominated — declare `guidance.canonical` in .ai/manifest.yaml",
        points: PENALTY.noCanonical,
        paths: nodes.map((n) => n.path),
      });
    }
    if (staleProjections.length) {
      deduct += PENALTY.staleProjection;
      penalties.push({
        reason: "A generated projection no longer matches its source (stale or hand-edited)",
        points: PENALTY.staleProjection,
        paths: staleProjections,
      });
    }
    coherence = Math.max(0, 100 - deduct);
  }

  return { version: "1", nodes, edges, canonical, canonicalBasis, contradictions, coherence, penalties };
}

/**
 * The graph for a snapshot, computed ONCE per scan.
 *
 * Two callers need it and they run in different phases: the D1 detector (signal extraction) and the
 * report composer (persistence + display). Memoized on the immutable per-scan snapshot — the same
 * pattern `aiStandardCached` uses in analyze/index.ts — so the parse is not paid twice and, more
 * importantly, so the number D1 scored and the graph the UI renders can never be two different reads.
 */
const GRAPH_BY_SNAPSHOT = new WeakMap<RepoSnapshot, GuidanceGraph>();
export function guidanceGraphFor(snap: RepoSnapshot): GuidanceGraph {
  let g = GRAPH_BY_SNAPSHOT.get(snap);
  if (!g) {
    g = buildGuidanceGraph(snap);
    GRAPH_BY_SNAPSHOT.set(snap, g);
  }
  return g;
}

/** Stamp per-file last-commit dates onto a graph's nodes, from the Context Health freshness lookups
 *  that only resolve after scoring. Returns a new graph; the scored coherence is untouched. */
export function withGuidanceFreshness(
  graph: GuidanceGraph,
  freshness: readonly { path: string; lastModifiedAt?: string }[],
): GuidanceGraph {
  const at = new Map(freshness.map((f) => [f.path, f.lastModifiedAt ?? null]));
  return { ...graph, nodes: graph.nodes.map((n) => ({ ...n, lastCommitAt: at.get(n.path) ?? n.lastCommitAt })) };
}

/** The node D1 grades for CONTENT: the canonical source, else the best-ranked SAMPLED document. Null
 *  when nothing was sampled — the caller must then award nothing rather than grade an empty string. */
export function gradedGuidanceNode(graph: GuidanceGraph): GuidanceNode | null {
  const sampled = graph.nodes.filter((n) => n.contentSampled);
  if (graph.canonical) {
    const c = sampled.find((n) => n.path === graph.canonical);
    // A pointer-only canonical says nothing about quality: grade what it points AT.
    if (c && !c.pointerOnly) return c;
    if (c) {
      const target = c.pointers.map((p) => sampled.find((n) => n.path === p)).find(Boolean);
      if (target) return target;
      return c;
    }
  }
  return sampled[0] ?? null;
}

/** Parse a persisted `guidanceGraphJson` blob. Never throws: a malformed or pre-r11 value is `null`,
 *  which every surface renders as "not assessed" — never as coherence 0. */
export function parseGuidanceGraphJson(raw: string | null | undefined): GuidanceGraph | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as GuidanceGraph;
    if (!v || typeof v !== "object" || v.version !== "1" || !Array.isArray(v.nodes)) return null;
    return {
      version: "1",
      nodes: Array.isArray(v.nodes) ? v.nodes : [],
      edges: Array.isArray(v.edges) ? v.edges : [],
      canonical: typeof v.canonical === "string" ? v.canonical : null,
      canonicalBasis: v.canonicalBasis ?? null,
      contradictions: Array.isArray(v.contradictions) ? v.contradictions : [],
      coherence: typeof v.coherence === "number" ? v.coherence : null,
      penalties: Array.isArray(v.penalties) ? v.penalties : [],
    };
  } catch {
    return null;
  }
}
