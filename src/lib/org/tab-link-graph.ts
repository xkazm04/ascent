// The org dashboard's cross-tab link graph, derived from source text. Pure: no fs, no Next — the
// caller hands in `{ path, source }` pairs, so the matcher can be proven against seeded strings as
// well as run over the tree (src/lib/org/tab-link-graph.test.ts does both).
//
// Why it exists: the proposed org path-of-use ADR (docs/adr/2026-09-14-org-path-of-use.md) argues
// the rail is "individually defensible and not navigable" from counts taken by an ad-hoc script. A
// count nobody re-runs turns the next "navigation improved" into a description of work. Pinned in a
// test, it is a number that moves.
//
// An EDGE is a link written in one tab's source to a DIFFERENT tab. A tab's source is its feature
// folder (`src/features/<group>/<tab>/`), plus the follow-ups ledger in `src/components/org/followups`
// and the group-less `src/features/developer/`. Five spellings of a tab link exist in that tree today,
// and a matcher that reads only the canonical helper misses a third of the real edges:
//
//   orgTabHref(slug, "security")              the helper every link is meant to use
//   tabHref(slug, "pairing")                  a local wrapper (CockpitSetup)
//   buildUrl(slug, { tab: "surfaces", … })    a tab switch that carries tab-scoped params
//   `/org/${slug}?tab=followups&dim=…`        a hand-built href
//   `/org/${slug}/integrations`               a legacy drill-in route (a redirect stub)

/** A source file handed to the graph builder. `path` is repo-relative with forward slashes. */
export interface SourceFile {
  path: string;
  source: string;
}

/** A call to a tab-href helper whose tab argument is not a literal — it links to whatever it computes. */
export interface DynamicTabLink {
  path: string;
  /** The tab whose source holds the call. */
  from: string;
}

export interface TabLinkGraph {
  /** tab id → the sibling tabs it links to (sorted). Every id is present, empty when it links nowhere. */
  outbound: Record<string, string[]>;
  /** tab id → the sibling tabs that link to it (sorted). */
  inbound: Record<string, string[]>;
  /** Non-literal helper calls. Not edges: a link that exists only on some days is not a path of use. */
  dynamic: DynamicTabLink[];
}

/**
 * Blank out `//` and block comments, keeping string and template literals intact (a tab link lives
 * in a string) and keeping line breaks (so a line-anchored reading of the result still lines up).
 * Comments are stripped because this repo explains, in prose, which tab each component links to —
 * a matcher that reads comments reports the explanation as the link.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, "");
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) {
        if (source[j] === "\\") j++;
        // A plain quote cannot span a line; stop there so one stray apostrophe in JSX text cannot
        // swallow the rest of the file as a "string".
        else if (c !== "`" && source[j] === "\n") break;
        j++;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const LITERAL_LINK =
  /\w*[Tt]abHref\(\s*[^,()]+?\s*,\s*["']([a-z-]+)["']\s*\)|\btab:\s*["']([a-z-]+)["']|\?tab=([a-z-]+)|\/org\/\$\{[^}]*\}\/([a-z-]+)/g;
const DYNAMIC_LINK = /\w*[Tt]abHref\(\s*[^,()]+?\s*,\s*(?!["'\s])[^)]/g;

/** The tab ids a source links to, in order of appearance (repeats and non-ids kept out). */
export function extractTabLinks(source: string, tabIds: readonly string[]): { links: string[]; dynamic: number } {
  const code = stripComments(source);
  const known = new Set(tabIds);
  const links: string[] = [];
  for (const m of code.matchAll(LITERAL_LINK)) {
    // `/api/org/${slug}/registry` is a fetch, not a tab route.
    if (m[4] && code.slice(0, m.index).endsWith("/api")) continue;
    const id = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (id && known.has(id) && !links.includes(id)) links.push(id);
  }
  return { links, dynamic: [...code.matchAll(DYNAMIC_LINK)].length };
}

/** The tab a source file belongs to, or null when it belongs to none (e.g. `shared/athena`). */
export function owningTab(path: string, tabIds: readonly string[]): string | null {
  if (path.startsWith("src/components/org/followups/")) return "followups";
  if (path.startsWith("src/features/developer/")) return "developer";
  const m = /^src\/features\/[^/]+\/([^/]+)\//.exec(path);
  const id = m?.[1];
  return id && tabIds.includes(id) ? id : null;
}

export function buildTabLinkGraph(files: readonly SourceFile[], tabIds: readonly string[]): TabLinkGraph {
  const out = new Map(tabIds.map((id) => [id, new Set<string>()]));
  const inb = new Map(tabIds.map((id) => [id, new Set<string>()]));
  const dynamic: DynamicTabLink[] = [];
  for (const file of files) {
    const from = owningTab(file.path, tabIds);
    if (!from) continue;
    const { links, dynamic: n } = extractTabLinks(file.source, tabIds);
    for (let k = 0; k < n; k++) dynamic.push({ path: file.path, from });
    for (const to of links) {
      if (to === from) continue;
      out.get(from)!.add(to);
      inb.get(to)!.add(from);
    }
  }
  const sorted = (m: Map<string, Set<string>>) =>
    Object.fromEntries([...m].map(([id, set]) => [id, [...set].sort()]));
  return { outbound: sorted(out), inbound: sorted(inb), dynamic };
}
