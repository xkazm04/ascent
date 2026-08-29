// GET  /api/org/:slug/registry/conformance -> the fleet's judged (context × subject) matrix
// POST /api/org/:slug/registry/conformance -> sweep the fleet's `.ai/registry-map.json` files
//
// `[slug]`-scoped, not `[id]`-scoped: the guards resolve the org and gate it, and every repo id in
// the sweep body is constrained by `orgId` inside the query, so a foreign repo is not found rather
// than separately refused.
//
// GET is a member read (`guardRegistryRead`); POST mints an installation token and therefore takes
// the same admin floor every other registry write does. The sweep is not destructive in the sense
// that needs a typed confirm — it re-reads files the org already owns — but it does spend GitHub
// requests, which is why it is not a member action.
//
// Evidence is TRUNCATED on the wire. The full `file:line` text is stored for the org's own UI; the
// matrix endpoint is a fleet overview and does not need paragraphs, and shipping them by default
// would put a lot of source-shaped text through a response nobody reads it in.

import { NextResponse } from "next/server";
import { getOrgId } from "@/lib/db/org-rollup";
import { guardRegistryRead, guardRegistryWrite, registryError } from "@/lib/registry/api";
import { listConformance, listConformanceMaps } from "@/lib/db/org-registry-conformance";
import { sweepConformance } from "@/lib/registry/conformance-sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How much evidence travels on the matrix response. The row keeps all of it. */
const WIRE_EVIDENCE = 400;

export async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const denied = await guardRegistryRead(slug);
  if (denied) return denied;

  const orgId = await getOrgId(slug).catch(() => null);
  if (!orgId) return NextResponse.json({ maps: [], pairs: [] });

  const [maps, pairs] = await Promise.all([listConformanceMaps(orgId), listConformance(orgId)]);
  return NextResponse.json({
    maps,
    pairs: pairs.map((p) => ({ ...p, evidence: p.evidence ? p.evidence.slice(0, WIRE_EVIDENCE) : null })),
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const gate = await guardRegistryWrite(slug);
  if (gate instanceof NextResponse) return gate;

  const body = (await request.json().catch(() => ({}))) as { repositoryIds?: unknown };
  const repositoryIds = Array.isArray(body.repositoryIds)
    ? body.repositoryIds.filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, 500)
    : undefined;

  try {
    const result = await sweepConformance(slug, gate.token, repositoryIds ? { repositoryIds } : {});
    if (result.scanned === 0) {
      return registryError("no-op", "This organization has no repositories to sweep.", 409);
    }
    return NextResponse.json(result);
  } catch (err) {
    // A whole-sweep failure is a real fault (the token, the database) — a per-repo failure never
    // reaches here, because sweepConformance degrades those into its own warnings.
    return registryError("github-error", err instanceof Error ? err.message : "The sweep could not run.", 502);
  }
}
