// Client-side scan-form coordinate. GitHub pastes stay on normalizeRepo. GitLab pastes use
// parseGitlabUrl — the same parser scanRepository already routes them through (parseForgeUrl,
// github first) — and emit the persisted `gitlab:group/project` identity.

import { parseGitlabUrl } from "@/lib/forge/gitlab/parse";
import { normalizeRepo } from "@/lib/repo-ref";

/** True when the input names GitLab as the host or uses the explicit `gitlab:` prefix.
 *  A bare `owner/repo` is GitHub, matching parseForgeUrl's github-first order. */
export function scanFormLooksLikeGitlab(raw: string): boolean {
  const trimmed = raw.trim();
  if (/^gitlab:(?!\/\/)/i.test(trimmed)) return true;
  const asUrl = trimmed.includes("://")
    ? trimmed
    : /^git@/i.test(trimmed)
      ? trimmed.replace(/^git@([^:]+):/i, "https://$1/")
      : /^[^/\s]+\.[^/\s]+\//.test(trimmed)
        ? `https://${trimmed}`
        : null;
  if (!asUrl) return false;
  try {
    return /(^|\.)gitlab\.com$/i.test(new URL(asUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * Normalize a scan-form paste/submit into the coordinate `/report?repo=` should carry:
 * GitHub `owner/repo`, or `gitlab:group/project` (subgroups kept whole).
 */
export function normalizeScanRepo(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const explicit = /^gitlab:(?!\/\/)(.+)$/i.exec(trimmed);
  if (explicit) {
    const parsed = parseGitlabUrl(explicit[1]!);
    return parsed ? `gitlab:${parsed.owner}/${parsed.repo}` : null;
  }

  if (scanFormLooksLikeGitlab(trimmed)) {
    const parsed = parseGitlabUrl(trimmed);
    return parsed ? `gitlab:${parsed.owner}/${parsed.repo}` : null;
  }

  return normalizeRepo(trimmed);
}
