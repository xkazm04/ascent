// The v1 registry-repo layout (docs/REGISTRY-AND-CARE-IMPL.md §1) and the seed files ascent scaffolds
// into a customer-owned repo by PR.
//
// DETERMINISTIC BY CONTRACT: `buildScaffoldFiles` is a pure function of the org slug. No timestamps,
// no uuids, no environment reads — so re-running the scaffold produces byte-identical content, which
// is what makes `openDraftPr`'s branch/file reuse an idempotent re-seed instead of a churning diff.
// It also carries NO secrets and NO proprietary content: everything here is public-safe boilerplate
// the customer owns the moment the PR merges.
//
// The emitted `.ascent/registry.yaml` and `catalog.json` match the reference registry
// (github.com/xkazm04/ai-registry) key-for-key — the settings file through `serializeRegistryYaml`
// and the catalog envelope through `buildCatalog`, so scaffold and indexer can never write two
// different shapes.

import { buildCatalog, serializeCatalog } from "./catalog";
import { DEFAULT_POLICIES, modeToYaml, serializeRegistryYaml } from "./policy";

/** Default repo name ascent proposes; any repo can be mapped instead. */
export const DEFAULT_REGISTRY_NAME = "ai-registry";

/** Branch every scaffold PR is cut on — stable, so a re-run updates the same PR. */
export const REGISTRY_SCAFFOLD_BRANCH = "ascent/registry-scaffold";

/** The marker file that identifies a repo as a registry. Its presence on the base branch means
 *  "already installed" — the scaffold refuses rather than overwriting (see scaffold.ts). */
export const REGISTRY_SPINE_PATH = ".ascent/registry.yaml";

/** Top-level directories the indexer walks, in ledger order. */
export const REGISTRY_DIRS = { skills: "skills", practices: "practices", memory: "memory" } as const;

export const REGISTRY_CATALOG_PATH = "catalog.json";
export const REGISTRY_SKILL_FILE = "SKILL.md";
export const REGISTRY_LESSONS_FILE = "LESSONS.md";
export const REGISTRY_PRACTICE_FILE = "PRACTICE.md";

/** One file in the scaffold, in the order it must be committed (spine first). */
export interface RegistryFile {
  path: string;
  body: string;
}

const README = (slug: string) => `# ${slug} — AI registry

The org's shared primitives live here: the **skills** its agents load, the **practices** its repos
adopt, and the **memory** it wants to survive a session. This repository is the source of truth —
Ascent indexes it and reports how the fleet is tracking against it, but never writes to it outside a
pull request.

## Layout

| Path | What it holds |
| --- | --- |
| \`skills/<name>/${REGISTRY_SKILL_FILE}\` | One skill, with a YAML frontmatter contract (\`name\`, \`description\`, \`category\`) |
| \`skills/<name>/${REGISTRY_LESSONS_FILE}\` | Append-only reflections on using that skill |
| \`practices/<slug>/${REGISTRY_PRACTICE_FILE}\` | The shape of a practice (frontmatter: \`id\`, \`dimension\`, \`applies-when\`) |
| \`practices/<slug>/starter/\` | Templatized starter artifacts a repo can adopt |
| \`memory/<kind>/<slug>.md\` | A durable note (frontmatter: \`kind\`, \`confidence\`, \`namespace\`, \`source\`) |
| \`${REGISTRY_CATALOG_PATH}\` | Generated index everyone syncs — do not hand-edit |
| \`${REGISTRY_SPINE_PATH}\` | Registry settings and policies |

## Working with it

You need nothing but \`git\` and a text editor.

\`\`\`bash
git clone https://github.com/${slug}/${DEFAULT_REGISTRY_NAME}
# edit skills/<name>/${REGISTRY_SKILL_FILE}, bump its version, append to ${REGISTRY_LESSONS_FILE}
git switch -c my-change && git commit -am "skills: sharpen the review checklist" && git push
\`\`\`

Open a pull request. A CODEOWNER merging it **is** the act of adopting the change. \`npx ascent skills
sync\` is a convenience over \`git pull\` — it is never required.

Point a repo at this registry from its \`.ai/manifest.yaml\`:

\`\`\`yaml
skills:
  registry: github:${slug}/${DEFAULT_REGISTRY_NAME}
\`\`\`
`;

const CODEOWNERS = (slug: string) => `# Merging a change here IS the act of adopting it, so review is the whole control.
# Replace the placeholder team with the group that owns each area.

*                   @${slug}/ai-registry-owners
/skills/            @${slug}/ai-registry-owners
/practices/         @${slug}/ai-registry-owners
/memory/            @${slug}/ai-registry-owners
/${REGISTRY_SPINE_PATH}  @${slug}/ai-registry-owners
`;

/** The generated index, seeded EMPTY. Rewritten by the indexer — never hand-edited. */
const CATALOG = (slug: string) =>
  serializeCatalog(
    buildCatalog({
      fullName: `${slug}/${DEFAULT_REGISTRY_NAME}`,
      defaultBranch: "main",
      canonical: true,
      mode: modeToYaml("git_native"),
      // A fresh registry reports NOTHING until its owner opts in; `.ascent/registry.yaml` is where
      // they flip it to `api` or `registry`.
      telemetry: "off",
    }),
  );

const GITKEEP = (what: string) => `# Keeps ${what}/ in git until the first entry lands. Safe to delete then.\n`;

/**
 * The seed tree for a new registry, SPINE FIRST.
 *
 * Order is load-bearing: `openScaffoldPr` treats a collision on `files[0]` (the registry.yaml spine)
 * as "already installed" and refuses the whole scaffold, while a collision on any later file is a
 * pre-existing real file that is skipped and reported. Same contract as `src/lib/standard/pr.ts`.
 */
export function buildScaffoldFiles(orgSlug: string): RegistryFile[] {
  const slug = orgSlug.trim().toLowerCase();
  return [
    {
      path: REGISTRY_SPINE_PATH,
      body: serializeRegistryYaml({
        registry: 1,
        canonical: true,
        mode: "git_native",
        telemetry: "off",
        policies: DEFAULT_POLICIES,
        owners: [],
      }),
    },
    { path: "README.md", body: README(slug) },
    { path: "CODEOWNERS", body: CODEOWNERS(slug) },
    { path: REGISTRY_CATALOG_PATH, body: CATALOG(slug) },
    { path: `${REGISTRY_DIRS.skills}/.gitkeep`, body: GITKEEP(REGISTRY_DIRS.skills) },
    { path: `${REGISTRY_DIRS.practices}/.gitkeep`, body: GITKEEP(REGISTRY_DIRS.practices) },
    { path: `${REGISTRY_DIRS.memory}/.gitkeep`, body: GITKEEP(REGISTRY_DIRS.memory) },
  ];
}

/** `owner/name` -> its parts, or null when the string isn't a well-formed full name. */
export function parseFullName(fullName: string): { owner: string; repo: string } | null {
  const m = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/.exec(fullName.trim());
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}
