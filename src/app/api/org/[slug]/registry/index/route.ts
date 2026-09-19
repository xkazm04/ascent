// POST /api/org/:slug/registry/index -> re-read the mapped registry at HEAD and rebuild the mirror rows.
//
// 200 { headSha, counts:{skills,practices,memory,lessons}, archived:{…}, warnings: string[] }
// 409 { error, code: "not-mapped" }  — nothing is mapped yet
// 502 { error, code: "github-error" } — the tree could not be read; the previous index survives
//
// `member` is enough here (not `admin` like map/migrate): re-indexing only re-reads content the org
// already owns and writes nothing to GitHub.
//
// LOCAL FIRST (self-hosted): a registry paired to a checkout in Admin -> Pairing is re-read from disk
// and needs no GitHub App; only an unpaired registry mints an installation token.

import { NextResponse } from "next/server";
import { getOrgRegistry } from "@/lib/db/org-registry";
import { registryError, resolveRegistrySource } from "@/lib/registry/api";
import { githubSource, indexRegistry } from "@/lib/registry/index-registry";
import { localSource } from "@/lib/registry/local-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const gate = await resolveRegistrySource(slug, { minRole: "member" });
  if (gate instanceof NextResponse) return gate;

  const registry = gate.kind === "local" ? gate.row : await getOrgRegistry(slug).catch(() => null);
  if (!registry) {
    return registryError("not-mapped", "This organization has no registry mapped yet.", 409);
  }

  const source = gate.kind === "local" ? localSource(gate.dir) : githubSource(gate.token, registry.fullName);
  const result = await indexRegistry(registry, source);
  if (result.kind === "error") {
    return registryError("github-error", result.message ?? "The registry could not be read.", 502);
  }
  return NextResponse.json({
    fullName: registry.fullName,
    source: gate.kind,
    headSha: result.headSha,
    counts: result.counts,
    archived: result.archived,
    warnings: result.warnings ?? [],
  });
}
