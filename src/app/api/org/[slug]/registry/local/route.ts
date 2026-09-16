// POST /api/org/:slug/registry/local -> map the registry checkout on THIS machine and index it.
//
// 200 { fullName, dir, branch, headSha, counts, archived, warnings }
// 404 { error, code: "not-found" }       — not a self-hosted deployment, or no local registry configured
// 502 { error, code: "github-error" }    — the checkout could not be read; the previous index survives
//
// SELF-HOSTED ONLY. The hosted map + index routes read through a GitHub App installation token; a
// self-hosted install usually has no App, but has the registry beside it on disk. The directory comes
// from server configuration (`registry.local` in the app's own `.ai/manifest.yaml`, or
// `ASCENT_REGISTRY_LOCAL`) — never from the request body — so this is not a path-reading endpoint.
// `admin`, like mapping on the hosted path: it replaces the org's canonical registry.

import { NextResponse } from "next/server";
import { resolveViewerLogin } from "@/lib/access";
import { selfHosted } from "@/lib/env";
import { upsertOrgRegistry } from "@/lib/db/org-registry";
import { guardRegistryRole, registryError } from "@/lib/registry/api";
import { indexRegistry } from "@/lib/registry/index-registry";
import { localCurrentBranch, localSource, resolveLocalRegistry } from "@/lib/registry/local-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!selfHosted()) return registryError("not-found", "Local registry mapping is only available on a self-hosted install.", 404);
  const denied = await guardRegistryRole(slug, "admin");
  if (denied) return denied;

  const target = await resolveLocalRegistry();
  if (!target) {
    return registryError("not-found", "No local registry configured: set registry.local in .ai/manifest.yaml or ASCENT_REGISTRY_LOCAL.", 404);
  }
  const branch = (await localCurrentBranch(target.dir)) ?? "main";

  const row = await upsertOrgRegistry(slug, {
    fullName: target.fullName,
    defaultBranch: branch,
    canonical: true,
    mode: "git_native",
    status: "scaffolding",
    createdBy: await resolveViewerLogin().catch(() => null),
  });
  if (!row) return registryError("persistence-off", "The registry could not be saved.", 503);

  const result = await indexRegistry(row, localSource(target.dir));
  if (result.kind === "error") {
    return registryError("github-error", result.message ?? "The local registry could not be read.", 502);
  }
  return NextResponse.json({
    fullName: target.fullName,
    dir: target.dir,
    branch,
    headSha: result.headSha,
    counts: result.counts,
    archived: result.archived,
    warnings: result.warnings ?? [],
  });
}
