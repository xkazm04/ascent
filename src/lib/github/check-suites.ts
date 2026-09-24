// GitHub App inventory from the check suites on the SCORED commit — the Settings-configured tooling
// a file scan structurally cannot see (deepening pass, 2026-08-17).
//
// A repo that runs default-setup CodeQL, Socket/Snyk/Wiz supply-chain checks, Codecov, the Claude /
// CodeRabbit review apps, or Vercel/Azure Pipelines CI has NOTHING committed for it: the app is
// installed at the org level and posts a check suite on every push. `GET /repos/{o}/{r}/commits/{sha}/
// check-suites` lists those suites with each one's `app.slug`, readable on public repos with an
// ordinary token (verified live 2026-08-17: vercel/next.js → azure-pipelines, sentry, vercel, claude,
// socket-security, wiz, datadog-official, github-actions; sindresorhus/got → codecov, claude), and on
// private repos through the App's existing "Checks: read" permission. One call, no new auth surface.
//
// The inventory is an ENRICHMENT folded into D2/D3/D4/D9 as additive evidence (analyze/platform-signals.ts
// and security/checks.ts). Null means "not observable here" (anonymous scan, or the read failed) and
// must never be read as "no apps installed"; an empty `apps` list on a 200 is a real zero.

import { encodePathSegments, fetchWithTimeout, ghHeaders, githubApiBase } from "@/lib/github/host";

/** One installed-App observation on the scored commit. */
export interface AppSuite {
  /** GitHub App slug, e.g. `github-code-scanning`, `claude`, `codecov`, `socket-security`. */
  slug: string;
  /** Human App name as GitHub reports it (display only). */
  name: string;
  /** Latest conclusion of that App's suite on this commit; null = still queued/in progress or unreported. */
  conclusion: string | null;
}

export interface AppInventory {
  /** The commit whose suites were read (lower-case sha, or the ref used when no sha was known). */
  sha: string;
  /** Distinct Apps (deduped by slug), including `github-actions`. */
  apps: AppSuite[];
  /** `total_count` from the API — the page cap is 100, so `truncated` flags a floor. */
  total: number;
  truncated: boolean;
  /**
   * Apps whose suites were seen on a recent merged PR HEAD and NOT on the scored commit (backlog row
   * 12, 2026-09-24): the PR-only SAST / coverage Apps that post on `pull_request` events and never on
   * the default branch. Credited since r22 (backlog row 42) for the PR-gate categories only,
   * through `prHeadAppsOf`; `appsOf` still reads the scored commit alone. Absent = no PR head was read (no token, no PR page, no merged PR, or
   * a forge without the read); present-and-empty = heads were read and added nothing new.
   */
  prHeadApps?: AppSuite[];
  /** The PR head shas whose suites were read for `prHeadApps`, most recent merge first. */
  prHeadShas?: string[];
  /** A PR-head read failed or its page was truncated, so `prHeadApps` is a floor. */
  prHeadTruncated?: boolean;
}

/**
 * The most PR heads the scan reads suites on, beside the scored commit. Each is one more
 * `/commits/{sha}/check-suites` call (concurrent, same timeout); the head shas themselves come off the
 * PR page ingestion already fetched, so there is no extra list call.
 */
export const PR_HEAD_INVENTORY_CAP = 3;

/**
 * Attach the PR-head observations to the scored commit's inventory. A slug the scored commit already
 * lists is dropped (it is not PR-only), and across heads the first (most recent) observation wins. A
 * failed (`null`) or truncated head read marks `prHeadTruncated`. No reads = `base` returned as is.
 */
export function withPrHeadApps(
  base: AppInventory,
  reads: { sha: string; inventory: AppInventory | null }[],
): AppInventory {
  if (!reads.length) return base;
  const seen = new Set(base.apps.map((a) => a.slug));
  const prHeadApps: AppSuite[] = [];
  let prHeadTruncated = false;
  for (const { inventory } of reads) {
    if (!inventory) {
      prHeadTruncated = true;
      continue;
    }
    if (inventory.truncated) prHeadTruncated = true;
    for (const app of inventory.apps) {
      if (seen.has(app.slug)) continue;
      seen.add(app.slug);
      prHeadApps.push({ ...app });
    }
  }
  return { ...base, prHeadApps, prHeadShas: reads.map((r) => r.sha), prHeadTruncated };
}

/**
 * Coarse category an App slug belongs to, for the detectors that fold the inventory into a score.
 * The vocabulary is intentionally conservative: an unknown slug is `other` and earns nothing. Owner:
 * the check-suites builder; consumers import from here so D3/D4/D9 can never disagree about what
 * `wiz` is.
 */
export type AppCategory =
  | "ai-review" // AI code-review / agent Apps (Claude, CodeRabbit, Greptile, Copilot review, …)
  | "sast" // code scanning (default-setup CodeQL posts as `github-code-scanning`)
  | "supply-chain" // dependency / secret / SCA scanners
  | "coverage" // coverage reporters
  | "ci" // non-Actions CI systems posting suites
  | "deploy" // deploy previews / platforms
  | "observability" // error / perf monitoring
  | "actions" // GitHub Actions itself
  | "other";

const APP_CATEGORY: Record<string, AppCategory> = {
  "github-actions": "actions",
  "github-code-scanning": "sast",
  "github-advanced-security": "sast",
  claude: "ai-review",
  coderabbitai: "ai-review",
  "greptile-apps": "ai-review",
  "copilot-pull-request-reviewer": "ai-review",
  "gemini-code-assist": "ai-review",
  "qodo-merge-pro": "ai-review",
  "ellipsis-dev": "ai-review",
  "sweep-ai": "ai-review",
  "cursor-com": "ai-review",
  "socket-security": "supply-chain",
  snyk: "supply-chain",
  "snyk-io": "supply-chain",
  gitguardian: "supply-chain",
  "trufflehog-enterprise": "supply-chain",
  "step-security": "supply-chain",
  "semgrep-app": "sast",
  sonarcloud: "sast",
  sonarqubecloud: "sast",
  codecov: "coverage",
  coveralls: "coverage",
  codacy: "coverage",
  "azure-pipelines": "ci",
  circleci: "ci",
  "circleci-checks": "ci",
  buildkite: "ci",
  "travis-ci": "ci",
  "cirrus-ci": "ci",
  "google-cloud-build": "ci",
  "graphite-app": "ci",
  vercel: "deploy",
  netlify: "deploy",
  "cloudflare-workers-and-pages": "deploy",
  render: "deploy",
  railway: "deploy",
  "render-com": "deploy",
  sentry: "observability",
  "sentry-io": "observability",
  "datadog-official": "observability",
};

/** Map an App slug (or a `wiz-<hash>` style suffixed slug) to its category; unknown → `other`. */
export function classifyApp(slug: string): AppCategory {
  const s = slug.toLowerCase();
  if (APP_CATEGORY[s]) return APP_CATEGORY[s];
  if (/^wiz(-|$)/.test(s)) return "supply-chain";
  if (/^snyk/.test(s)) return "supply-chain";
  if (/^codeql/.test(s)) return "sast";
  return "other";
}

/** Distinct Apps of one category in an inventory (stable order = API order). */
export function appsOf(inv: AppInventory | null | undefined, category: AppCategory): AppSuite[] {
  if (!inv) return [];
  return inv.apps.filter((a) => classifyApp(a.slug) === category);
}

/**
 * The categories an App seen only on a recent merged PR head is CREDITED for (r22, backlog row 42):
 * the PR-gate tools, whose natural home is the pull request. A default-setup CodeQL, Semgrep, Socket,
 * Codecov or CodeRabbit App posts on `pull_request` events and may never post on the default branch,
 * yet it runs on every change that merges; it earns the same award as on the scored commit.
 *
 * Deliberately absent: `ci` (the D3 award is "a pipeline builds the default branch", which a PR-only
 * suite does not show) and `deploy` (a PR-head deploy suite is a preview, not an automated deploy).
 */
const PR_HEAD_CREDITED: ReadonlySet<AppCategory> = new Set<AppCategory>(["ai-review", "sast", "coverage", "supply-chain"]);

/**
 * Distinct Apps of one category seen ONLY on recent PR heads, for the folds that credit them beside
 * `appsOf`. Empty for a category PR heads are not credited for, for an inventory with no PR-head read,
 * and for a malformed persisted list. A slug the scored commit lists is never repeated here (it is
 * credited once, there), even on an inventory not built by `withPrHeadApps`. `prHeadTruncated` never
 * removes anything: the list is a floor, and what it names still counts.
 */
export function prHeadAppsOf(inv: AppInventory | null | undefined, category: AppCategory): AppSuite[] {
  if (!inv || !PR_HEAD_CREDITED.has(category) || !Array.isArray(inv.prHeadApps)) return [];
  const onCommit = new Set(inv.apps.map((a) => a.slug));
  return inv.prHeadApps.filter((a) => classifyApp(a.slug) === category && !onCommit.has(a.slug));
}

/**
 * Where a credited set of Apps was observed, for its evidence line. With nothing on PR heads this is
 * the r7 wording byte-for-byte (`the scored commit`, bare slugs); PR-head Apps are named apart so a
 * reader can tell a PR-only App from one on the default branch.
 */
export function observedOn(commit: AppSuite[], prHead: AppSuite[]): { where: string; slugs: string } {
  const list = (apps: AppSuite[]) => apps.map((a) => a.slug).join(", ");
  if (!prHead.length) return { where: "the scored commit", slugs: list(commit) };
  if (!commit.length) return { where: "recent PR heads", slugs: list(prHead) };
  return { where: "the scored commit", slugs: `${list(commit)} · on recent PR heads: ${list(prHead)}` };
}

const API = githubApiBase();
const TIMEOUT_MS = 10_000;
/** One page. The API caps `per_page` at 100, so a larger `total_count` means the list is a floor. */
const PER_PAGE = 100;

/** The slice of a check-suite row this module reads (everything else on the row is ignored). */
interface RawSuite {
  app?: { slug?: unknown; name?: unknown } | null;
  conclusion?: unknown;
  updated_at?: unknown;
}

/** Epoch ms of an API timestamp; -Infinity when absent/unparseable so it always loses a `>` compare. */
function at(v: unknown): number {
  if (typeof v !== "string") return -Infinity;
  const t = Date.parse(v);
  return Number.isNaN(t) ? -Infinity : t;
}

/**
 * Collapse the raw suite rows to one row per App.
 *
 * A busy repo posts several suites for the same App on one commit (a re-run, a matrix, a queued suite
 * that was superseded), so the raw list is not an inventory until it is deduped. Two rules, in order:
 * a suite that REPORTED something beats one that is still `null` (queued/in-progress tells us nothing
 * about the App's verdict), and between two reported suites the later `updated_at` wins. Order is the
 * API's, keyed on first appearance, so the inventory reads the same way twice.
 */
function dedupeSuites(rows: RawSuite[]): AppSuite[] {
  const order: string[] = [];
  const bySlug = new Map<string, { entry: AppSuite; updatedAt: number }>();
  for (const row of rows) {
    const rawSlug = row?.app?.slug;
    // No app / no slug = a suite we cannot attribute to an installed App. Skip, don't invent one.
    if (typeof rawSlug !== "string" || !rawSlug.trim()) continue;
    const key = rawSlug.trim().toLowerCase();
    const conclusion = typeof row.conclusion === "string" ? row.conclusion : null;
    const updatedAt = at(row.updated_at);
    const prev = bySlug.get(key);
    if (!prev) {
      const name = typeof row?.app?.name === "string" && row.app.name.trim() ? row.app.name.trim() : key;
      order.push(key);
      bySlug.set(key, { entry: { slug: key, name, conclusion }, updatedAt });
      continue;
    }
    const wins =
      prev.entry.conclusion === null
        ? conclusion !== null // anything reported beats "we don't know yet"
        : conclusion !== null && updatedAt > prev.updatedAt; // both reported → the fresher verdict
    if (wins) {
      prev.entry.conclusion = conclusion;
      prev.updatedAt = updatedAt;
    }
  }
  return order.map((k) => bySlug.get(k)!.entry);
}

/**
 * Read the check suites posted on `sha` and return the deduped App inventory. Null on any non-200 or
 * transport failure (a blip must never invent an empty inventory).
 *
 * `sha` may be a full commit sha OR a ref name (the scan passes the scored head, falling back to the
 * pinned ref / default branch), which is why the path is encoded segment-wise: `release/2.1` must stay
 * two segments or the read 404s and a repo silently loses its whole App inventory.
 */
export async function fetchAppInventory(
  owner: string,
  repo: string,
  sha: string,
  token: string,
  signal?: AbortSignal,
): Promise<AppInventory | null> {
  const raw = typeof sha === "string" ? sha.trim() : "";
  if (!raw) return null;
  const url =
    `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/commits/${encodePathSegments(raw)}/check-suites?per_page=${PER_PAGE}`;
  try {
    const res = await fetchWithTimeout(url, { headers: ghHeaders(token) }, TIMEOUT_MS, signal);
    // 403/404 = the token can't read checks here (or the ref is gone). "Not observable", not "no apps".
    if (res.status !== 200) return null;
    const body = (await res.json().catch(() => null)) as { total_count?: unknown; check_suites?: unknown } | null;
    if (!body || typeof body !== "object") return null;
    const rows = body.check_suites;
    // A 200 whose body didn't parse into the documented shape (proxy HTML, truncated stream) is a
    // failed read, not an empty inventory — same guard as fetchBranchGovernance.
    if (!Array.isArray(rows)) return null;
    const apps = dedupeSuites(rows as RawSuite[]);
    const totalCount = typeof body.total_count === "number" && Number.isFinite(body.total_count) ? body.total_count : null;
    return {
      sha: raw.toLowerCase(),
      apps,
      total: totalCount ?? rows.length,
      truncated: totalCount !== null && totalCount > PER_PAGE,
    };
  } catch {
    return null;
  }
}
