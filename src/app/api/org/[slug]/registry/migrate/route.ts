// POST /api/org/:slug/registry/migrate?type=skills|practices|memory
// Export the rows ascent still HOSTS for one artifact type into the registry layout, as one draft PR.
//
// 200 { type, opened: true,  prUrl, prNumber, branch, committed[], skipped[], reused }
// 200 { type, opened: false, moved: 0, total: 0, message }   — nothing hosted to migrate (NO empty PR)
// 400 { error, code: "invalid-input" } — unknown `type`
// 409 { error, code: "not-mapped" }    — no registry mapped yet
//
// One PR per type by design: a single PR moving an org's whole knowledge base is unreviewable, and
// this content is only worth anything if a human reads it.

import { NextResponse } from "next/server";
import { getOrgRegistry } from "@/lib/db/org-registry";
import { setMigrationStep } from "@/lib/db/org-registry-write";
import { listHostedArtifacts } from "@/lib/db/org-registry-hosted";
import { githubErrorResponse, guardRegistryWrite, registryError } from "@/lib/registry/api";
import { buildMigrationFiles, MIGRATION_TYPES, openMigrationPr, type MigrationType } from "@/lib/registry/migrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const gate = await guardRegistryWrite(slug);
  if (gate instanceof NextResponse) return gate;

  const raw = new URL(request.url).searchParams.get("type") ?? "";
  if (!(MIGRATION_TYPES as readonly string[]).includes(raw)) {
    return registryError("invalid-input", `\`type\` must be one of: ${MIGRATION_TYPES.join(", ")}.`, 400);
  }
  const type = raw as MigrationType;

  const registry = await getOrgRegistry(slug).catch(() => null);
  if (!registry) return registryError("not-mapped", "Map a registry before migrating into it.", 409);

  const hosted = await listHostedArtifacts(slug);
  const files = buildMigrationFiles(type, hosted);
  if (files.length === 0) {
    // A no-op, not an error: an org with nothing hosted has nothing to move. Never open an empty PR.
    await setMigrationStep(registry.id, type, { state: "n/a", moved: 0, total: 0 }).catch(() => {});
    return NextResponse.json({
      type,
      opened: false,
      moved: 0,
      total: 0,
      message: `No hosted ${type} to migrate.`,
    });
  }

  try {
    const pr = await openMigrationPr({
      token: gate.token,
      slug,
      fullName: registry.fullName,
      type,
      files,
      base: registry.defaultBranch,
    });
    if (pr.kind === "bad-repo") return registryError("invalid-input", pr.message, 400);
    if (pr.kind === "empty") {
      await setMigrationStep(registry.id, type, { state: "merged", moved: files.length, total: files.length }).catch(
        () => {},
      );
      return NextResponse.json({ type, opened: false, moved: files.length, total: files.length, message: pr.message });
    }
    await setMigrationStep(registry.id, type, {
      state: "pr-open",
      prUrl: pr.url,
      moved: pr.committed.length,
      total: files.length,
    }).catch(() => {});
    return NextResponse.json({
      type,
      opened: true,
      prUrl: pr.url,
      prNumber: pr.number,
      branch: pr.branch,
      committed: pr.committed,
      skipped: pr.skipped,
      reused: pr.reused,
      total: files.length,
    });
  } catch (err) {
    return githubErrorResponse(err);
  }
}
