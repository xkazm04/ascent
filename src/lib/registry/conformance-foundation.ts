// The PURE parsers for a managed repo's foundation files, read by the conformance sweep beside its
// map: `.ai/manifest.yaml` (the `knowledge.domains` list and the `scope:` block) and
// `.ai/directions/ledger.jsonl` (the owner's decisions on proposed directions).
//
// These are the inputs `classifyAbsence` (./absence.ts) reads, and they are parsed the way the
// registry parses them — `scripts/lib/projects.mjs` `domainsOf()` and `build-fleet-map.mjs`
// `readScope()` / `loadLedger()` — deliberately small line readers rather than a YAML dependency
// (`package.json` carries none, and adding one for two keys would be the larger risk). Anything the
// reader does not understand is IGNORED, never guessed: a manifest with a scope block this cannot
// read classifies every in-domain absence as a candidate, which is the registry's own fallback.

import type { DirectionDecision, RepoDirection, RepoScope } from "./absence";

export const EMPTY_SCOPE: RepoScope = { outOfScopeCategories: [], outOfScopeSubjects: [] };

export interface ManifestFoundation {
  /** `knowledge.domains`, as declared. [] when the manifest declares none. */
  domains: string[];
  /** The `scope:` block's exclusion lists; `null` when the manifest has no `scope:` block at all —
   *  a different fact from an empty one, and what the fleet map reports as `scope: missing`. */
  scope: RepoScope | null;
}

const unquote = (s: string): string => {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
};

const parseInlineList = (s: string): string[] =>
  s.trim().replace(/^\[/, "").replace(/\]$/, "").split(",").map(unquote).filter(Boolean);

/** Strip a trailing ` # comment` — but not a `#` inside quotes, which the manifest never uses. */
const stripComment = (line: string): string => line.replace(/\s+#.*$/, "");

/**
 * `knowledge.domains`. The registry's `domainsOf()` reads only the inline form (`domains: [a, b]`);
 * this also accepts the block form (`domains:` followed by `- a` lines) because YAML allows it and a
 * manifest written by hand may use either. Looked up as the first `domains:` key at any indent, the
 * same way `domainsOf()` does.
 */
export function parseManifestDomains(text: string): string[] {
  const inline = text.match(/^\s*domains:\s*\[([^\]]*)\]/m);
  if (inline) return parseInlineList(inline[1]!);
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*domains:\s*$/.test(stripComment(l)));
  if (start < 0) return [];
  const indent = lines[start]!.match(/^\s*/)![0].length;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = stripComment(lines[i]!);
    if (!line.trim()) continue;
    const lead = line.match(/^\s*/)![0].length;
    if (lead <= indent) break;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (!item) break;
    const v = unquote(item[1]!);
    if (v) out.push(v);
  }
  return out;
}

/**
 * The `scope:` block, exactly as `readScope()` reads it: a top-level `scope:` line, two-space keys
 * under it, inline lists or `- item` block lists, one level of nesting. Returns null when the
 * manifest has no block.
 */
export function parseManifestScope(text: string): RepoScope | null {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^scope:\s*$/.test(stripComment(l)));
  if (start < 0) return null;
  const scope: Record<string, string[] | string> = {};
  let key: string | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (/^\S/.test(raw)) break; // next top-level key
    const line = stripComment(raw);
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const kv = line.match(/^\s{2}([a-zA-Z_]+):\s*(.*)$/);
    if (kv) {
      key = kv[1]!;
      const val = kv[2]!.trim();
      if (val.startsWith("[")) scope[key] = parseInlineList(val);
      else if (val === "") scope[key] = [];
      else scope[key] = unquote(val);
      continue;
    }
    const item = line.match(/^\s{4,}-\s+(.*)$/);
    const list = key ? scope[key] : undefined;
    if (item && Array.isArray(list)) list.push(unquote(item[1]!));
  }
  const list = (k: string): string[] => (Array.isArray(scope[k]) ? (scope[k] as string[]).filter(Boolean) : []);
  return { outOfScopeCategories: list("out_of_scope_categories"), outOfScopeSubjects: list("out_of_scope_subjects") };
}

/** Both reads over one manifest body. */
export function parseManifestFoundation(text: string): ManifestFoundation {
  return { domains: parseManifestDomains(text), scope: parseManifestScope(text) };
}

const DECISIONS: readonly DirectionDecision[] = ["accepted", "declined", "deferred"];

/**
 * `.ai/directions/ledger.jsonl` → the LATEST decision per (bundle, subject). The ledger is
 * chronological and append-only, so "last row wins" is the registry's own rule (`loadLedger` +
 * the `ledgerBySubject` map). A malformed line is skipped, never guessed — the file is written by
 * hand and a torn last line must not cost the decisions above it. A row with no `bundle` is kept
 * under `""`, where it can never match a subject — the same outcome the registry's keying gives it.
 */
export function parseDirectionsLedger(jsonl: string): RepoDirection[] {
  const latest = new Map<string, RepoDirection>();
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row: { subject?: unknown; bundle?: unknown; decision?: unknown };
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const subject = typeof row.subject === "string" ? row.subject.trim() : "";
    const decision = typeof row.decision === "string" ? (row.decision.trim() as DirectionDecision) : null;
    if (!subject || !decision || !DECISIONS.includes(decision)) continue;
    const bundle = typeof row.bundle === "string" ? row.bundle.trim() : "";
    latest.set(`${bundle}/${subject}`, { subject, bundle, decision });
  }
  return Array.from(latest.values());
}
