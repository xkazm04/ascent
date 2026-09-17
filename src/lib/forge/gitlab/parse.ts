// GitLab URL parser. Lives apart from the snapshot source so a client surface (ScanForm) can
// import it without pulling the GitLab HTTP stack into the browser bundle. gitlabForge.parseUrl
// is this function; parseForgeUrl / scanRepository already route gitlab.com pastes through it.

import type { ForgeHost, ParsedRepo } from "@/lib/forge/types";
import { gitlabWebBase } from "@/lib/forge/gitlab/http";

/**
 * A GitLab coordinate. `owner` is the project's NAMESPACE PATH and `repo` its last segment, so
 * `owner/repo` reconstitutes the full path GitLab's API addresses — including subgroups
 * (`group/sub/project` → owner `group/sub`, repo `project`).
 *
 * The spec wrote "owner = top-level group", which is the same thing for the common single-level case
 * and loses the path for a nested one; a lost subgroup is a 404 on every read, so the namespace path
 * is what is carried. The persisted identity is `gitlab:group/sub/project` either way
 * (`forgeFullName`), which is why the live `@@unique([orgId, fullName])` needs no migration.
 */
export function parseGitlabUrl(input: string, host?: ForgeHost): ParsedRepo | null {
  if (!input) return null;
  let s = input.trim();
  s = s.replace(/^git@([^:]+):/i, "https://$1/");
  s = s.replace(/\.git$/i, "");

  const webHost = safeHostname(gitlabWebBase(host));
  let path: string | null = null;

  if (s.includes("://")) {
    try {
      const url = new URL(s);
      const isGitlabCom = /(^|\.)gitlab\.com$/i.test(url.hostname);
      const isConfiguredHost = Boolean(webHost) && url.hostname.toLowerCase() === webHost;
      if (!isGitlabCom && !isConfiguredHost) return null;
      path = url.pathname;
    } catch {
      return null;
    }
  } else {
    // Scheme-less, two accepted shapes:
    //  - a HOST-qualified path (`gitlab.com/group/project`), which GitHub's parser rejects because its
    //    first segment contains a dot — so this branch is the only thing that can claim it;
    //  - a BARE path (`group/sub/project`), which only ever reaches here through an explicit
    //    `gitlab:` prefix, because the registry offers an unprefixed bare path to GitHub FIRST and
    //    GitHub accepts every one of them. A first segment carrying a dot that ISN'T a gitlab host is
    //    refused rather than guessed at: an unknown self-hosted host is not this adapter's to claim.
    const hostQualified = /^([^/\s]+)\/(.+)$/.exec(s);
    const first = hostQualified?.[1] ?? "";
    if (first.includes(".")) {
      const isGitlabish = /(^|\.)gitlab\./i.test(first) || (Boolean(webHost) && first.toLowerCase() === webHost);
      if (!isGitlabish) return null;
      path = `/${hostQualified![2]}`;
    } else {
      path = `/${s}`;
    }
  }

  // Strip GitLab's `/-/` route separator and everything after it (`/-/tree/main`, `/-/merge_requests`),
  // then the trailing segments a pasted deep link carries.
  const cut = path.split("/-/")[0] ?? path;
  const segments = cut.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const ok = /^[A-Za-z0-9_.-]{1,100}$/;
  for (const seg of segments) {
    if (!ok.test(seg) || seg.startsWith(".") || seg.includes("..")) return null;
  }
  const repo = segments[segments.length - 1]!;
  const owner = segments.slice(0, -1).join("/");
  return { owner, repo };
}

function safeHostname(base: string): string {
  try {
    return new URL(base).hostname.toLowerCase();
  } catch {
    return "";
  }
}
