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
//
// A Gradle root costs ONE more call (the root build file) to prove the ktlint plugin; without that
// proof the lint command is the placeholder. The file text is tested and dropped, never stored.

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

/** The ktlint Gradle plugin id. A quoted occurrence in the ROOT build file is the only proof. */
const KTLINT_PLUGIN = /["']org.jlleitschuh.gradle.ktlint["']/;

/** True when the root build file text applies the ktlint plugin by its quoted id (`id("…")` or
 *  `apply plugin: "…"`). A version-catalog alias, convention plugin, buildSrc or subproject file
 *  never reaches here, so none of them count. */
export function appliesKtlintPlugin(buildFileText: string): boolean {
  return KTLINT_PLUGIN.test(buildFileText);
}

interface Root {
  buildSystem: JvmBuildSystem;
  names: string[];
}

async function listRoot(
  ref: ParsedRepo,
  defaultBranch: string | undefined,
  token?: string,
): Promise<Root> {
  try {
    const url = `${githubApiBase()}/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(defaultBranch || "HEAD")}`;
    const res = await ghFetch(url, { token, cache: "no-store" });
    if (!res.ok) return { buildSystem: "unknown", names: [] };
    const json = (await res.json()) as { tree?: { path?: string; type?: string }[] };
    const names = (json.tree ?? []).filter((e) => e.type === "blob" && typeof e.path === "string").map((e) => e.path!);
    return { buildSystem: classifyRoot(names), names };
  } catch {
    return { buildSystem: "unknown", names: [] };
  }
}

/** ONE more call: the root build file the listing named, same token as the tree call. The text is
 *  tested and dropped; any failure is "not proven". */
async function ktlintProven(
  ref: ParsedRepo,
  root: Root,
  defaultBranch: string | undefined,
  token?: string,
): Promise<boolean> {
  try {
    const file = root.names.includes("build.gradle.kts") ? "build.gradle.kts" : "build.gradle";
    const url = `${githubApiBase()}/repos/${ref.owner}/${ref.repo}/contents/${file}?ref=${encodeURIComponent(defaultBranch || "HEAD")}`;
    const res = await ghFetch(url, { token, cache: "no-store", accept: "application/vnd.github.raw+json" });
    if (!res.ok) return false;
    return appliesKtlintPlugin(await res.text());
  } catch {
    return false;
  }
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
  return (await listRoot(ref, defaultBranch, token)).buildSystem;
}

/** `ctx` with its `buildSystem` filled in for a JVM repo; returned unchanged (no call) otherwise. */
export async function withBuildSystem<T extends Omit<RepoContext, "house">>(
  ref: ParsedRepo,
  ctx: T,
  token?: string,
): Promise<T> {
  if (!isJvmLanguage(ctx.primaryLanguage)) return ctx;
  const root = await listRoot(ref, ctx.defaultBranch, token);
  const { buildSystem } = root;
  // Gradle roots only: one more call decides whether the lint task exists. Maven makes none.
  const gradle = buildSystem === "gradle" || buildSystem === "gradle-kts";
  const ktlintApplied = gradle ? await ktlintProven(ref, root, ctx.defaultBranch, token) : undefined;
  return { ...ctx, buildSystem, ...(ktlintApplied ? { ktlintApplied } : {}) };
}
