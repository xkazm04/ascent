// Reflect-as-PR (#36): a consolidation over registry-origin memory becomes a reviewable pull
// request in the customer's own repo instead of a database write the next index pass would revert.
//
// THE ROUND TRIP THIS EXISTS FOR. Applying a reflection to a registry-origin row in ascent's table
// would be overwritten on the next index pass — so performing it would be a lie told with a
// spinner. Instead the rollup is written as a new `memory/<kind>/<slug>.md` whose frontmatter cites
// the notes it replaces BY PATH; a CODEOWNER merging that PR is what makes it true, and the next
// index pass reads `supersedes:` and stamps `supersededBy` on the old rows.
//
// Nothing in the customer's repo is deleted. The old notes stay in git; the frontmatter is the link.
//
// This copies `openMigrationPr`'s shape in this same directory rather than inventing a fifth PR
// layering. `practices/apply.ts` is the other candidate host and is another lane's file, with a
// practice-shaped artifact vocabulary that does not fit a memory note.

import { AppApiError } from "@/lib/github/app";
import { openDraftPr } from "@/lib/github/write";
import { parseFullName } from "./layout";

/** `[a-z0-9-]`, capped — a filename, not a title. */
export function slugifyNoteName(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "reflection";
}

export interface MemoryNote {
  kind: string;
  namespace: string | null;
  confidence: number;
  content: string;
  /** Repo-relative paths of the notes this one replaces. */
  supersedes: string[];
}

const yamlValue = (v: string) => (/^[A-Za-z0-9._\/-]+$/.test(v) ? v : JSON.stringify(v));

/**
 * The note file, frontmatter first.
 *
 * `supersedes` is a list of PATHS. Never DB uuids: the registry is a tenant-free artifact that
 * outlives any one deployment, and a uuid in a reviewer's diff is an opaque token they cannot check.
 * A path is something they can open.
 */
export function buildMemoryNoteFile(note: MemoryNote): string {
  const lines = [
    "---",
    `kind: ${yamlValue(note.kind)}`,
    ...(note.namespace ? [`namespace: ${yamlValue(note.namespace)}`] : []),
    `confidence: ${Math.min(1, Math.max(0, note.confidence))}`,
    "source: ascent:reflection",
    ...(note.supersedes.length ? [`supersedes: ${note.supersedes.map(yamlValue).join(", ")}`] : []),
    "---",
    "",
    note.content.trim(),
    "",
  ];
  return lines.join("\n");
}

export interface ProposeMemoryPrInput {
  token: string;
  /** `owner/name` of the registry repo. */
  fullName: string;
  defaultBranch?: string;
  kind: string;
  slug: string;
  note: MemoryNote;
  /** Who asked for it — printed in the PR body so a reviewer knows whose reflection this is. */
  actor: string | null;
}

export type ProposeMemoryPrResult =
  | { ok: true; url: string; number: number; branch: string; path: string; reused: boolean }
  | { ok: false; reason: string; status: number };

/** One branch per slug, so a retry updates its own PR instead of opening a second. */
export const memoryPrBranch = (slug: string) => `ascent/memory-${slug}`;

export async function proposeMemoryPr(input: ProposeMemoryPrInput): Promise<ProposeMemoryPrResult> {
  const ref = parseFullName(input.fullName);
  if (!ref) return { ok: false, reason: `"${input.fullName}" is not a valid repository name.`, status: 400 };
  const path = `memory/${input.kind}/${input.slug}.md`;

  try {
    const pr = await openDraftPr({
      token: input.token,
      owner: ref.owner,
      repo: ref.repo,
      branch: memoryPrBranch(input.slug),
      ...(input.defaultBranch ? { base: input.defaultBranch } : {}),
      path,
      content: buildMemoryNoteFile(input.note),
      commitMessage: `memory: consolidate ${input.note.supersedes.length} notes into ${input.slug}`,
      prTitle: `memory: ${input.slug}`,
      prBody:
        `A consolidation proposed from Ascent${input.actor ? ` by @${input.actor}` : ""}.\n\n` +
        (input.note.supersedes.length
          ? `It supersedes:\n${input.note.supersedes.map((p) => `- \`${p}\``).join("\n")}\n\n` +
            "Those files are NOT deleted — the frontmatter is the link, and merging this is what retires them.\n"
          : "It supersedes nothing; it is a new note.\n"),
    });
    return { ok: true, url: pr.url, number: pr.number, branch: pr.branch, path, reused: pr.reused };
  } catch (err) {
    if (err instanceof AppApiError && err.status === 409) {
      // `openDraftPr` refuses to overwrite a file already on base. Surfaced as its own message
      // because "already exists" is a state the user can act on (pick another slug), not a fault.
      return { ok: false, reason: `\`${path}\` already exists in the registry — won't overwrite it.`, status: 409 };
    }
    if (err instanceof AppApiError) {
      return { ok: false, reason: `GitHub rejected the request (${err.status}).`, status: err.status === 404 ? 404 : 502 };
    }
    return { ok: false, reason: "GitHub could not be reached. Try again in a moment.", status: 502 };
  }
}
