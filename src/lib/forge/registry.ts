// The forge registry — resolution, and the URL router.
//
// ORDER IS THE CONTRACT. `parseForgeUrl` tries an explicit `<forge>:` prefix first, then each
// registered forge's own parser in REGISTRATION order with **github first**. That ordering is not a
// style choice: it is the guarantee that every input which parses today parses identically, because
// GitHub's parser sees each input before any other forge does and its behaviour is unchanged. The
// GitLab parser only ever sees inputs GitHub already declined (an explicit `gitlab.com` URL, which
// `parseRepoUrl` rejects outright, or an explicit prefix).
//
// `parseRepoUrl` (src/lib/github/source.ts) is deliberately NOT routed through here. It is the
// GitHub parser, `githubForge.parseUrl` is reference-equal to it (asserted in github-parity.test.ts),
// and keeping the dependency one-way — registry → github adapter → github/source — is what stops an
// import cycle from forming through the module that half the codebase imports.

import { githubForge } from "@/lib/forge/github";
import { gitlabForge } from "@/lib/forge/gitlab/source";
import { localForge } from "@/lib/forge/local";
import { isForgeId, type Forge, type ForgeCapabilities, type ForgeHost, type ForgeId, type ParsedRepo } from "@/lib/forge/types";

/** Registration order is resolution order for `parseForgeUrl`. GitHub is first, always. */
const REGISTRY = new Map<ForgeId, Forge>();

/** Register (or replace) a forge. Idempotent: re-registering the same id keeps its ORIGINAL position
 *  in the parse order, so a hot-reload cannot silently reorder the router. */
export function registerForge(forge: Forge): void {
  REGISTRY.set(forge.id, forge);
}

registerForge(githubForge);
registerForge(gitlabForge);
registerForge(localForge);

/** Every registered forge, in registration (= parse) order. */
export function registeredForges(): Forge[] {
  return [...REGISTRY.values()];
}

/**
 * The forge for a parsed repo or an explicit id. DEFAULTS TO GITHUB for anything unrecognized —
 * a column written by an older build, a hand-edited row, a typo'd query param — because GitHub is
 * what every existing row means and guessing a different forge would silently point a scan at the
 * wrong API.
 */
export function resolveForge(input?: ParsedRepo | { forge?: string | null } | string | null): Forge {
  const id =
    typeof input === "string"
      ? input
      : input && typeof input === "object" && "forge" in input
        ? input.forge
        : undefined;
  const forge = isForgeId(id) ? REGISTRY.get(id) : undefined;
  return forge ?? REGISTRY.get("github")!;
}

/** The capability manifest for a forge id. Unknown ids read as GitHub's, matching `resolveForge`. */
export function forgeCapabilities(id?: string | null): ForgeCapabilities {
  return resolveForge(id ?? undefined).capabilities;
}

/**
 * Route an input to a forge and parse it. Returns the parsed coordinate plus the forge that claimed
 * it, or null when nothing did.
 *
 * Two entry shapes:
 *  - `gitlab:group/sub/project` — an EXPLICIT prefix. Unambiguous, and the shape the coordinate
 *    persists as (see `forgeFullName`).
 *  - a bare URL / coordinate — offered to each forge in order, github first.
 */
export function parseForgeUrl(
  input: string,
  host?: ForgeHost,
): (ParsedRepo & { forge: ForgeId }) | null {
  if (!input) return null;
  const trimmed = input.trim();

  // Explicit prefix. Matched against REGISTERED ids only, and only when the remainder is non-empty,
  // so a URL scheme (`https://…`) can never be read as a forge prefix.
  const prefix = /^([a-z][a-z0-9]*):(?!\/\/)(.+)$/i.exec(trimmed);
  if (prefix) {
    const id = prefix[1]!.toLowerCase();
    const rest = prefix[2]!;
    if (isForgeId(id)) {
      const forge = REGISTRY.get(id);
      const parsed = forge?.parseUrl(rest, host);
      return parsed && forge ? { ...parsed, forge: forge.id } : null;
    }
  }

  for (const forge of REGISTRY.values()) {
    // `local` never claims an unprefixed input — a bare `owner/name` is GitHub, as it always was.
    if (forge.id === "local") continue;
    const parsed = forge.parseUrl(trimmed, host);
    if (parsed) return { ...parsed, forge: forge.id };
  }
  return null;
}

/**
 * The persisted `Repository.fullName` for a coordinate — THE identity decision of this lane.
 *
 * GitHub stays byte-identical (`owner/name`), so not one existing row moves and the live
 * `@@unique([orgId, fullName])` needs no migration. A non-GitHub repo is namespaced in the VALUE
 * (`gitlab:group/project`), which cannot collide with a GitHub `group/project` because a GitHub
 * coordinate can never contain a colon. Routes that take `?repo=owner/name` keep working unchanged.
 */
export function forgeFullName(forge: ForgeId | string | undefined, owner: string, repo: string): string {
  return prefixForge(forge, `${owner}/${repo}`);
}

/** {@link forgeFullName} for callers that already hold the joined `owner/name` (the persist layer
 *  canonicalises it to lowercase first, and that canonical form must not be re-split). */
export function prefixForge(forge: ForgeId | string | undefined, fullName: string): string {
  return !forge || forge === "github" ? fullName : `${forge}:${fullName}`;
}

/**
 * Which forge a repo's WEB url belongs to. Used at the three `repository.upsert` sites, which hold a
 * `RepoMeta` (whose `url` the source filled in from the forge's own API) but no forge id.
 *
 * This is an INFERENCE, and it is a stopgap. The durable fix is a `forge` field on `RepoMeta` — a
 * one-line additive change to `src/lib/types.ts`, which is Class C and belongs to the Director; it is
 * requested in this lane's handoff. Until then the inference is safe because it is conservative in
 * exactly the direction that matters: anything it cannot positively identify persists as `github`,
 * which is what every existing row already is, so a wrong guess can never re-label a GitHub repo.
 */
export function forgeFromWebUrl(url: string | undefined | null): ForgeId {
  if (!url) return "github";
  for (const forge of REGISTRY.values()) {
    if (forge.id === "github" || forge.id === "local") continue;
    if (forge.parseUrl(url)) return forge.id;
  }
  return "github";
}

/** The inverse of {@link forgeFullName}: split a persisted fullName back into forge + coordinate.
 *  An unprefixed value is GitHub — which is what every pre-#4 row is. */
export function splitForgeFullName(fullName: string): { forge: ForgeId; fullName: string } {
  const m = /^([a-z][a-z0-9]*):(.+)$/i.exec(fullName.trim());
  const id = m?.[1]?.toLowerCase();
  if (m && isForgeId(id)) return { forge: id, fullName: m[2]! };
  return { forge: "github", fullName: fullName.trim() };
}
