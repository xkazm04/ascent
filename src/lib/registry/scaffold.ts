// Seed the v1 registry layout into a customer-owned repo as ONE draft PR.
//
// Layered on `openDraftPr` (@/lib/github/write) exactly like `src/lib/standard/pr.ts` is: same
// installation-token flow, same never-clobber-a-base-file guard, same branch/PR reuse. `openDraftPr`
// is single-file, so we call it once per scaffold file against one branch — the first call creates
// the branch + the draft PR, each later call reuses them.
//
// COLLISION POLICY (the half worth reading):
//   • the SPINE (`.ascent/registry.yaml`, files[0]) already on the base branch means this repo is
//     ALREADY a registry. The 409 propagates as `{ kind: "already-installed" }` and NOTHING is
//     written — mapping it is the correct action, not scaffolding it again.
//   • any LATER file colliding is a pre-existing real file (a repo may well already have a README or
//     a CODEOWNERS). It is never overwritten: the path is skipped and reported, and the rest of the
//     scaffold still lands. Refusing the whole PR over one such file would make the install
//     unreachable for exactly the repos most likely to want it.

import { AppApiError, githubAppFetch } from "@/lib/github/app";
import { openDraftPr, type OpenPrResult } from "@/lib/github/write";
import { buildScaffoldFiles, parseFullName, REGISTRY_SCAFFOLD_BRANCH } from "./layout";

export interface OpenScaffoldPrInput {
  /** Installation access token for the repo's owner. */
  token: string;
  /** Org slug the registry belongs to — the only thing the seed content varies on. */
  slug: string;
  /** Target repo, "owner/name". May differ from the slug (any repo can be mapped). */
  fullName: string;
  /** Base branch; resolved to the repo default when omitted. */
  base?: string;
}

export type ScaffoldPrResult =
  | {
      kind: "ok";
      url: string;
      number: number;
      branch: string;
      /** Paths actually committed, in scaffold order. */
      committed: string[];
      /** Paths skipped because the repo already had a real file there. */
      skipped: string[];
      /** True when an already-open PR for this head was returned instead of a new one. */
      reused: boolean;
    }
  | { kind: "already-installed"; message: string }
  | { kind: "bad-repo"; message: string };

const PR_TITLE = "Set up the AI registry";

const prBody = (slug: string) => `Scaffolds the v1 registry layout for **${slug}** — skills, practices
and memory as files in this repository, reviewed the way code is reviewed.

**Nothing is adopted until you merge.** Everything in this PR is public-safe boilerplate you own:
a README explaining the layout, \`.ascent/registry.yaml\` (settings + policies), a placeholder
\`CODEOWNERS\` you should point at your real team, an empty generated \`catalog.json\`, and the three
artifact directories.

Before merging:

1. Replace the placeholder team in \`CODEOWNERS\` — merging a change here **is** the act of adopting it.
2. Check \`.ascent/registry.yaml\` (\`mode\`, \`telemetry\`, \`policies\`).

Ascent will index this repository after the merge and report how the fleet tracks against it. It
never writes here outside a pull request.

_Opened by Ascent._`;

/**
 * Open (or re-open) the scaffold PR for `fullName`. Idempotent: a second call reuses the branch and
 * the open PR and re-seeds identical content, because `buildScaffoldFiles` is deterministic.
 *
 * Never throws for the two conditions a caller must distinguish (a malformed repo name, a repo that
 * is already a registry) — those come back as typed results. Genuine GitHub failures (auth, rate
 * limit, network) still throw `AppApiError` so the route can map the status.
 */
export async function openScaffoldPr(input: OpenScaffoldPrInput): Promise<ScaffoldPrResult> {
  const ref = parseFullName(input.fullName);
  if (!ref) return { kind: "bad-repo", message: `"${input.fullName}" is not a valid owner/repo name.` };

  const files = buildScaffoldFiles(input.slug);
  const committed: string[] = [];
  const skipped: string[] = [];
  let pr: OpenPrResult | null = null;

  for (const [i, f] of files.entries()) {
    try {
      pr = await openDraftPr({
        token: input.token,
        owner: ref.owner,
        repo: ref.repo,
        branch: REGISTRY_SCAFFOLD_BRANCH,
        base: input.base,
        path: f.path,
        content: f.body,
        commitMessage: `chore(registry): add ${f.path} (via Ascent)`,
        prTitle: PR_TITLE,
        prBody: prBody(input.slug),
      });
      committed.push(f.path);
    } catch (err) {
      const collision = err instanceof AppApiError && err.status === 409;
      if (collision && i === 0) {
        return {
          kind: "already-installed",
          message: `${input.fullName} already carries ${f.path} — map it as a registry instead of scaffolding it.`,
        };
      }
      if (collision) {
        skipped.push(f.path);
        continue;
      }
      throw err;
    }
  }

  // Unreachable unless every file after the spine threw a non-409 (which rethrows above).
  if (!pr) throw new Error("openScaffoldPr: no pull request was opened");
  return { kind: "ok", url: pr.url, number: pr.number, branch: pr.branch, reused: pr.reused, committed, skipped };
}

export type CreateRepoResult =
  | { kind: "ok"; fullName: string; defaultBranch: string }
  | { kind: "exists"; fullName: string; defaultBranch: string }
  | { kind: "denied"; message: string };

/**
 * Create `<org>/<name>` through the installation, INITIALIZED (`auto_init`) so it has a default
 * branch — `openDraftPr` cuts its branch from one and cannot work against an empty repo.
 *
 * Only ORGANIZATION accounts are supported: `POST /orgs/{org}/repos` is the sole repo-creation
 * endpoint an installation token can reach, and it needs `administration: write`. A user account
 * would require a user-to-server token, so `getRegistryCapabilities` reports `canCreateRepo: false`
 * there and the UI offers "map an existing repo" instead of a dead button.
 *
 * An ALREADY-EXISTING repo comes back as `exists` rather than an error: the create is then a no-op
 * and the caller proceeds straight to the scaffold PR, which is what a retry should do.
 */
export async function createRegistryRepo(token: string, org: string, name: string): Promise<CreateRepoResult> {
  try {
    const repo = await githubAppFetch<{ full_name: string; default_branch: string }>(`/orgs/${org}/repos`, token, {
      method: "POST",
      body: JSON.stringify({
        name,
        private: true,
        auto_init: true,
        description: "Shared skills, practices and memory for AI-assisted development. Indexed by Ascent.",
        has_issues: true,
        has_wiki: false,
        has_projects: false,
      }),
    });
    return { kind: "ok", fullName: repo.full_name, defaultBranch: repo.default_branch || "main" };
  } catch (err) {
    if (err instanceof AppApiError && (err.status === 422 || err.status === 409)) {
      try {
        const existing = await githubAppFetch<{ full_name: string; default_branch: string }>(`/repos/${org}/${name}`, token);
        return { kind: "exists", fullName: existing.full_name, defaultBranch: existing.default_branch || "main" };
      } catch {
        return { kind: "denied", message: `Could not create ${org}/${name}: the name is taken or invalid.` };
      }
    }
    if (err instanceof AppApiError && (err.status === 403 || err.status === 404)) {
      return {
        kind: "denied",
        message: `Ascent's GitHub App cannot create repositories in ${org}. Grant it "Administration: write", or map an existing repository instead.`,
      };
    }
    throw err;
  }
}
