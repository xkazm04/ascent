// Which build tool a JVM repo uses, so the generated AGENTS.md / ci.yml carry commands that run.
//
// `commandsFor('java')` used to answer mvn for every Java repo, so a Gradle-built one received a
// starter that failed on its first run. The language cannot tell; the repo root can. This is the ONE
// detector the preview (/api/practices/generate) and the commit (applyPracticeToRepo) both call, so the
// two bodies agree and the previewFingerprint drift guard holds.
//
// Source: one non-recursive git-trees call on the default branch, only for java/kotlin. Nothing stored
// carries a repo's root file list (the scan keeps a manifest READOUT, not the build manifests), so a
// stored read would need a scan to have run and could be stale; the live call is the same freshness
// the preview already has. A failed call is `unknown` (placeholders), never a guess.

import { ghFetch, githubApiBase } from "@/lib/github/host";
import type { ParsedRepo } from "@/lib/github/source";
import type { JvmBuildSystem, RepoContext } from "@/lib/practice-artifact";

/** Languages whose commands depend on the build tool. Everything else makes no extra call. */
export function isJvmLanguage(language?: string | null): boolean {
  const l = (language ?? "").toLowerCase();
  return l === "java" || l === "kotlin";
}

/** Classify a root listing. Both Maven and Gradle present, or neither, is `unknown`. */
export function classifyRoot(names: readonly string[]): JvmBuildSystem {
  const set = new Set(names);
  const maven = set.has("pom.xml");
  const gradle = set.has("build.gradle");
  const kts = set.has("build.gradle.kts");
  if (maven && (gradle || kts)) return "unknown";
  if (maven) return "maven";
  if (gradle && kts) return "gradle";
  if (kts) return "gradle-kts";
  if (gradle) return "gradle";
  return "unknown";
}

/**
 * The build system of `ref`'s default branch root, or undefined when `language` is not a JVM language
 * (no call is made). One GitHub call; any failure resolves `unknown`.
 */
export async function detectBuildSystem(
  ref: ParsedRepo,
  language: string | null | undefined,
  defaultBranch: string | undefined,
  token?: string,
): Promise<JvmBuildSystem | undefined> {
  if (!isJvmLanguage(language)) return undefined;
  try {
    const url = `${githubApiBase()}/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(defaultBranch || "HEAD")}`;
    const res = await ghFetch(url, { token, cache: "no-store" });
    if (!res.ok) return "unknown";
    const json = (await res.json()) as { tree?: { path?: string; type?: string }[] };
    const names = (json.tree ?? []).filter((e) => e.type === "blob" && typeof e.path === "string").map((e) => e.path!);
    return classifyRoot(names);
  } catch {
    return "unknown";
  }
}

/** `ctx` with its `buildSystem` filled in for a JVM repo; returned unchanged (no call) otherwise. */
export async function withBuildSystem<T extends Omit<RepoContext, "house">>(
  ref: ParsedRepo,
  ctx: T,
  token?: string,
): Promise<T> {
  const buildSystem = await detectBuildSystem(ref, ctx.primaryLanguage, ctx.defaultBranch, token);
  return buildSystem ? { ...ctx, buildSystem } : ctx;
}
