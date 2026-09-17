// Pure ingestion selection, byte admission and memory quarantine shared by every source adapter.
import type { RepoFile, FetchedFile } from "@/lib/types";
import { MAX_FILE_BYTES, MAX_CODEOWNERS_BYTES, MAX_TOTAL_BYTES } from "./ingestion-limits";
import { MEMORY_ENTRY_RE } from "@/lib/standard/memory-entry";


// Ingestion budgets — keep prompts small and avoid hammering hosts.
// Exported because the /connect privacy disclosure (PrivacyNotice.tsx) interpolates this number —
// the user-facing "how many files leave the boundary" claim must derive from the real budget, not
// a hand-copied literal that drifts when the budget changes. Workflows get a RESERVED quota on top
// (MAX_WORKFLOW_FILES below), which the disclosure calls out in prose.
export const MAX_FILES = 50;

// Security (D9) is scored by a deterministic check battery that reads WORKFLOW CONTENT (token perms,
// pinned actions, dangerous patterns, SAST, signing). The old 3-workflow cap made those checks blind on
// exactly the big repos (next.js has 36 workflows), so fetch far more — ranked LAST (see pickFilesToFetch)
// so the LLM prompt window still front-loads README/manifests/source and only the detectors read the tail.
const MAX_WORKFLOW_FILES = 24;

// The three locations GitHub honors CODEOWNERS (root, .github/, docs/) — mirrors codeowners.ts's
// CODEOWNERS_PATH_RE and the exact names pickFilesToFetch requests, matched case-insensitively.
const CODEOWNERS_PATH_RE = /^(?:\.github\/|docs\/)?codeowners$/i;

// ── `.ai/memory` mirror (moonshot #14) ───────────────────────────────────────────────────────────
// Repo-authored memory entries are fetched so the org can INDEX them (src/lib/memory/repo-memory-mirror.ts),
// never so a scorer can read them. Two constants, exported because the pick guard and the quarantine
// partition below are the two halves of one contract and a test has to be able to name it.
/** Newest N numbered `.ai/memory/NNNN-*.md` entries fetched per scan. */
export const MAX_MEMORY_FILES = 12;

/** A NUMBERED memory entry. README.md and unnumbered files are deliberately excluded: the number is
 *  the append-only ordering the format promises, and an unnumbered file is prose, not an entry. */
export { MEMORY_ENTRY_RE } from "@/lib/standard/memory-entry";


/**
 * Choose which files to fetch contents for, within MAX_FILES. We always grab
 * high-signal files (manifests, AI config, CI, docs) then sample a few source/test
 * files so the LLM gets a feel for the codebase.
 *
 * `subPath` (G7-08) re-aims the budget at one package of a monorepo. It deliberately does NOT filter
 * everything: a 12-package monorepo's problem is that the ~50-slot budget is spread across the whole
 * tree so each package gets a couple of files, NOT that repo-wide files are unwanted. So the split is:
 *
 *   • repo-wide, kept regardless — root README/manifests/configs (step 1), CODEOWNERS, SECURITY.md,
 *     and ALL CI workflows (step 7): `.github/workflows/*` plus GitLab `.gitlab-ci.yml` / `.gitlab/ci/*`.
 *     These feed deterministic batteries that are repo-level facts; filtering them out would floor D9
 *     on every sub-path scan exactly the way the old 3-workflow cap did (see MAX_WORKFLOW_FILES).
 *   • sub-tree preferred/scoped — the package's OWN manifests (step 1b), and the docs/test/source
 *     SAMPLES (steps 4-6), which are the slots that were being spread thin in the first place.
 *   • agent guidance (step 0) — repo-wide, but sub-tree copies rank first, since a nested
 *     `packages/api/CLAUDE.md` is the more specific D1 evidence for this scan.
 */
export function pickFilesToFetch(blobs: RepoFile[], subPath?: string): string[] {
  const paths = blobs.map((b) => b.path);
  const picked = new Set<string>();

  const add = (p: string) => {
    if (picked.size < MAX_FILES) picked.add(p);
  };

  // In-scope test + orderings for the sub-path mode. `scoped()` narrows a candidate list to the
  // sub-tree; `preferScoped()` keeps everything but floats the sub-tree's entries to the front so a
  // `.slice(n)` cap spends its slots on them first. Both are identity when no subPath is set, which is
  // what keeps the default pick byte-for-byte unchanged.
  const inScope = (p: string) => !subPath || p === subPath || p.startsWith(`${subPath}/`);
  const scoped = (list: string[]) => (subPath ? list.filter(inScope) : list);
  const preferScoped = (list: string[]) =>
    subPath ? [...list.filter(inScope), ...list.filter((p) => !inScope(p))] : list;

  // 0. Agent-guidance files ANYWHERE in the tree — we fetch their contents to assess
  //    guidance *quality* (D1), not just presence (e.g. .claude/CLAUDE.md, nested AGENTS.md).
  preferScoped(
    paths.filter((p) =>
      /(^|\/)(claude\.md|agents?\.md|\.cursorrules|\.windsurfrules)$/i.test(p) ||
      /^\.github\/copilot-instructions\.md$/i.test(p) ||
      /^\.cursor\/rules\//i.test(p),
    ),
  )
    // 6, not 4 (moonshot #15, landed here because W1-B owns this function — conflict W1-#6): the
    // guidance graph samples these nodes and an unfetched node degrades to `contentSampled: false`.
    // A repo with a root CLAUDE.md, a root AGENTS.md, copilot-instructions and two nested guides
    // already exceeded 4, so the two most specific nested files were the ones being dropped.
    .slice(0, 6)
    .forEach(add);

  // 1. Exact high-signal filenames (root or nested).
  const exactNames = [
    "readme.md",
    "readme",
    "readme.rst",
    "claude.md",
    "agents.md",
    "agent.md",
    ".cursorrules",
    ".windsurfrules",
    ".aider.conf.yml",
    "package.json",
    "pyproject.toml",
    "go.mod",
    "cargo.toml",
    "pom.xml",
    "build.gradle",
    "gemfile",
    "composer.json",
    "tsconfig.json",
    "eslint.config.js",
    "eslint.config.mjs",
    ".eslintrc.json",
    ".eslintrc.js",
    "biome.json",
    "ruff.toml",
    ".pre-commit-config.yaml",
    "contributing.md",
    "security.md",
    "changelog.md",
    "codeowners",
    ".github/codeowners",
    "docs/codeowners",
    ".github/copilot-instructions.md",
    ".github/dependabot.yml",
    "renovate.json",
    ".renovaterc.json",
    "dockerfile",
    "docker-compose.yml",
    "openapi.yaml",
    "openapi.json",
    "vercel.json",
    // The `.ai/` standard's two declaration files (moonshot #13, landed here on W1-A's behalf —
    // conflict W1-#6). `aiStandard()` has read `idx.content(".ai/manifest.yaml")` for its
    // "declares capabilities + control placement" award since it shipped, but the manifest was in
    // NO fetch step, so the content was always "" and the award was dead code. Fetching it makes an
    // existing deterministic award start firing on repos that already qualify — a score movement
    // with no rubric change, recorded in the r11 note (00-INDEX X-#5).
    ".ai/manifest.yaml",
    ".ai/manifest.yml",
    ".ai/guardrails.yaml",
    ".ai/guardrails.yml",
  ];
  const lowerMap = new Map(paths.map((p) => [p.toLowerCase(), p]));
  // 1a. The SUB-TREE's own copies of those high-signal names, FIRST. On a `packages/api` scan the
  //     package's README/manifest/tsconfig are the primary evidence, so they take prompt priority over
  //     the monorepo root's (which step 1b still adds right after — the root manifest carries the
  //     workspace layout and the repo's identity, which a package scan still wants in context).
  //     No-op without a subPath.
  if (subPath) {
    for (const name of exactNames) {
      const hit = lowerMap.get(`${subPath.toLowerCase()}/${name}`);
      if (hit) add(hit);
    }
  }
  // 1b. Exact high-signal filenames at the repo root (or their canonical nested locations).
  for (const name of exactNames) {
    const hit = lowerMap.get(name);
    if (hit) add(hit);
  }

  // (CI workflow CONTENT is fetched in bulk at the END — see step 7 — so the security check battery
  //  sees every workflow, while these high-signal files keep prompt priority.)

  // 3. Cursor rules dir, MCP configs. Repo-wide (`.cursor/rules/` only exists at the root), but a
  //    nested `packages/api/.mcp.json` floats first under a sub-path scan.
  preferScoped(paths.filter((p) => /^\.cursor\/rules\//i.test(p) || /(^|\/)\.?mcp\.json$/i.test(p)))
    .slice(0, 3)
    .forEach(add);

  // 4. ADRs / docs samples. SCOPED under a sub-path scan: a monorepo's root `docs/` tree would
  //    otherwise eat the sample slots with material about other packages.
  scoped(paths.filter((p) => /^docs\/.*\.(md|mdx)$/i.test(p) || /adr.*\.(md|mdx)$/i.test(p)))
    .slice(0, 3)
    .forEach(add);

  // 5. A sample of test files — SCOPED (this is the budget that was being spread thin).
  scoped(
    paths.filter((p) =>
      /(^|\/)(__tests__|tests?|spec)\//i.test(p) ||
      /\.(test|spec)\.[a-z0-9]+$/i.test(p) ||
      /_test\.[a-z0-9]+$/i.test(p),
    ),
  )
    .slice(0, 4)
    .forEach(add);

  // 6. A sample of source files to give the LLM texture — SCOPED, same reason as step 5.
  scoped(
    paths.filter(
      (p) =>
        /\.(ts|tsx|js|jsx|py|go|rs|java|rb|kt|cs|php)$/i.test(p) &&
        !/(^|\/)(node_modules|dist|build|vendor|\.next)\//i.test(p) &&
        !picked.has(p),
    ),
  )
    .slice(0, 6)
    .forEach(add);

  // 7. ALL CI workflows (up to MAX_WORKFLOW_FILES) — the deterministic D9 security battery reads full
  //    workflow CONTENT (token perms, pinned actions, SAST, signing). github-repo-data-access #4: `add()`
  //    refuses once picked.size >= MAX_FILES, so on a manifest-heavy polyglot monorepo the shared 50-slot
  //    budget fills on manifests/docs/source BEFORE this step and few or ZERO workflows get fetched —
  //    re-blinding the exact checks the bulk-workflow ingest exists to feed. Give workflows a RESERVED
  //    quota ON TOP of MAX_FILES (add straight to the set, bypassing the count gate) so texture files can't
  //    starve them; MAX_TOTAL_BYTES already budgets for the extra content, and they still rank LAST for the
  //    prompt window (files.sort by fetchRank keeps README/manifests/source front-loaded).
  paths
    .filter((p) => /^\.github\/workflows\/.+\.(ya?ml)$/i.test(p))
    .slice(0, MAX_WORKFLOW_FILES)
    .forEach((p) => picked.add(p)); // reserved quota — deliberately NOT gated by MAX_FILES

  // GitLab pipelines live in `.gitlab-ci.yml` (plus optional `.gitlab/ci/*` includes), not
  // `.github/workflows/`. Same reserved class, own slice: a GitHub-only tree stays byte-identical,
  // and a full MAX_FILES budget cannot starve GitLab CI the way it used to starve Actions.
  paths
    .filter((p) => /(^|\/)\.gitlab-ci\.ya?ml$/i.test(p) || /^\.gitlab\/ci\/.+\.(ya?ml)$/i.test(p))
    .slice(0, MAX_WORKFLOW_FILES)
    .forEach((p) => picked.add(p));

  // 8. `.ai/memory/NNNN-*.md` — the repo's own agent-written memory entries (moonshot #14). LAST, and
  //    a RESERVED quota like workflows: these must never displace a manifest or a source sample from
  //    the prompt budget, and they must not silently vanish on a repo whose 50 slots are already full.
  //    Newest first by the numeric prefix, capped at MAX_MEMORY_FILES.
  //
  //    THE LOAD-BEARING PART: everything picked here is REMOVED from `RepoSnapshot.files` by the
  //    quarantine in fetchSnapshot (and its local-source twin) before any scorer sees the snapshot.
  //    These bodies are untrusted prose from a customer repo; the pick list is an INGEST list, not a
  //    prompt list. Adding a memory path anywhere else in this function would put it in the prompt.
  memoryPicks(paths).forEach((p) => picked.add(p));

  return [...picked];
}


/**
 * The `.ai/memory` entries a scan ingests, newest first — the ordering used by the pick step above and
 * asserted directly by `source-memory-pick.test.ts`. Pure and repo-wide on purpose: a sub-path scan of
 * a monorepo still mirrors the repo's memory, because `.ai/` is a repo-level declaration.
 */
export function memoryPicks(paths: string[]): string[] {
  const numbered = paths
    .map((p) => ({ p, n: Number(MEMORY_ENTRY_RE.exec(p)?.[1] ?? NaN) }))
    .filter((x) => Number.isFinite(x.n));
  // Newest (highest prefix) first; ties broken by path so the pick stays deterministic for cache keys.
  numbered.sort((a, b) => b.n - a.n || a.p.localeCompare(b.p));
  return numbered.slice(0, MAX_MEMORY_FILES).map((x) => x.p);
}


/** The per-file truncation cap this path is charged (and cut to): CODEOWNERS is parsed exactly, not
 *  fed to a prompt, so it carries the larger cap. One function so the PLAN and the CUT cannot drift. */
export function capForPath(path: string): number {
  return CODEOWNERS_PATH_RE.test(path) ? MAX_CODEOWNERS_BYTES : MAX_FILE_BYTES;
}


/** What the byte budget admitted, and what it pushed out. */
export interface FetchPlan {
  /** The files that WILL be fetched, in pick (= fetchRank) order. */
  admitted: string[];
  /** Picks the budget pushed out, in pick order. Never silent: they are a term in estimateCoverage. */
  displaced: string[];
}


/**
 * Decide WHICH picks the MAX_TOTAL_BYTES budget pays for, BEFORE a single byte is fetched.
 *
 * THE EXACT RULE: walk `picks` in pick order (which is `fetchRank` order — the same order the prompt
 * window reads them in, so the budget spends on the highest-signal files first, and the reserved
 * workflow / `.ai/memory` tails still sit exactly where step 7/8 of pickFilesToFetch put them). Charge
 * each path `min(listed size, its per-file cap)` — the most bytes it can possibly contribute after
 * truncation. Admit it WHILE `planned + cost <= MAX_TOTAL_BYTES`; at the FIRST path that does not fit,
 * admission closes and every remaining pick is displaced. Closing (rather than skipping ahead to the
 * next file that happens to fit) is deliberate: it reproduces what the previous sequential-order case
 * did — the old worker `return`ed once the running total reached the cap, ending its lane — so the
 * admitted set stays as close as it can to the volume the rubric was calibrated on.
 *
 * A pick with NO listed size (the tree omitted it) is charged its full cap: the plan is never allowed
 * to be optimistic about a file it cannot measure. The listed size is BYTES and the cut is by UTF-16
 * code units, so on multibyte content the charge is an over-estimate — conservative in the same
 * direction, and never a reason to re-open a closed plan.
 *
 * Pure, exported and total: the set is a function of (tree sizes, picks, budget) alone, which is the
 * whole point — reproducibility of the scored file set across re-scans of the same commit.
 */
export function planFetchBudget(
  picks: readonly string[],
  sizeOf: (path: string) => number | undefined,
): FetchPlan {
  const admitted: string[] = [];
  let planned = 0;
  for (let i = 0; i < picks.length; i++) {
    const path = picks[i]!;
    const cap = capForPath(path);
    const listed = sizeOf(path);
    const cost = Math.min(typeof listed === "number" && listed >= 0 ? listed : cap, cap);
    if (planned + cost > MAX_TOTAL_BYTES) return { admitted, displaced: picks.slice(i) };
    planned += cost;
    admitted.push(path);
  }
  return { admitted, displaced: [] };
}


/**
 * THE QUARANTINE (moonshot #14). Split fetched contents into the prompt-visible `files` and the
 * mirror-only `memoryFiles`, and report how many of the ATTEMPTED picks were non-memory so
 * `estimateCoverage` is computed over the same population it always was — the mirror must not be able
 * to move a repo's coverage number (and through it, the cache-pinning threshold).
 *
 * Exported and shared by both RepoSource implementations so the two ingestion paths cannot drift, and
 * so the wave-4 GitHub-adapter extraction (#4) has one symbol to carry across rather than a code block
 * to remember.
 */
export function quarantineMemoryFiles(
  fetched: FetchedFile[],
  picks: string[],
): { files: FetchedFile[]; memoryFiles: FetchedFile[]; nonMemoryAttempted: number } {
  const files: FetchedFile[] = [];
  const memoryFiles: FetchedFile[] = [];
  for (const f of fetched) {
    if (MEMORY_ENTRY_RE.test(f.path)) memoryFiles.push(f);
    else files.push(f);
  }
  return {
    files,
    memoryFiles,
    nonMemoryAttempted: picks.filter((p) => !MEMORY_ENTRY_RE.test(p)).length,
  };
}


export function estimateCoverage(
  totalBlobs: number,
  fetched: number,
  attempted: number,
  truncated: boolean,
  displaced = 0,
): number {
  // Heuristic: how confident are we that we've seen the signal-bearing files?
  // Small repos -> high coverage; truncated giant repos -> lower.
  // Factor in the fetch SUCCESS RATE of the files we actually tried to read: a small repo used to pin
  // 0.95 regardless of how many picks failed, so a transient raw-host blip that dropped half the files
  // still read as fully covered — and the scan routes then CACHED that degraded snapshot for the full
  // TTL (their guard keys off this coverage). Scaling by fetched/attempted pushes a blip-degraded scan
  // below the cache threshold so it isn't pinned; a few legitimately-empty files barely move it.
  //
  // github-repo-data-access #3: the LARGE-repo branch used `0.4 + fetched/totalBlobs`, but `fetched` is
  // capped at MAX_FILES (~50) so for ANY repo with >500 blobs the term is <0.1 and coverage lands <0.5 —
  // tripping the "only part of the repository could be inspected" caveat (scan.ts) and suppressing caching
  // for essentially EVERY non-trivial repo, purely on file COUNT, not any real ingestion shortfall. Base
  // large-repo confidence on the SUCCESS RATE of the signal-bearing picks (fetched/attempted) too, capped
  // a notch below the small-repo ceiling to reflect the larger unseen tail — so a fully-successful ingest
  // of a big repo no longer reads as degraded, while a genuine blip (many picks failing) still does.
  //
  // `attempted` is now the set the BYTE PLAN admitted, so `fetched/attempted` measures fetch success
  // and nothing else. The picks the plan DISPLACED are disclosed as their own multiplicative term
  // rather than being folded into that ratio or dropped: a displaced file lowers confidence by exactly
  // the same proportion it did when it sat in the old `attempted` denominator, so a repo whose picks
  // all fit scores its coverage unchanged — the number just stopped depending on network timing.
  // `displaced` defaults to 0 for the ingestion paths that cannot displace (a sequential reader).
  const fetchRate = attempted > 0 ? fetched / attempted : 1;
  const admitRate = attempted + displaced > 0 ? attempted / (attempted + displaced) : 1;
  const rate = fetchRate * admitRate;
  let c = totalBlobs <= MAX_FILES ? 0.95 * rate : Math.min(0.9, 0.85 * rate);
  if (truncated) c = Math.min(c, 0.6);
  return Math.round(c * 100) / 100;
}
