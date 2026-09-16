// POST /api/org/:slug/registry/local — pair the org's registry with a working copy on THIS server.
//
//   { path }                    → verify it as a registry checkout, pair it, index it
//   { path, verifyOnly: true }  → run the checks, persist nothing (Admin -> Pairing's "Check")
//   {}                          → the same, for the path this app's own manifest names (`registry.local`)
//   { path: null }              → unpair; the row and its last index stay, reads fall back to GitHub
//
// 200 { ok, paired, check, fullName?, source: "local", headSha?, counts?, warnings? }
// 422 { ok: false, check, error }   — the folder is not a registry checkout
// 404                                 — not a self-hosted deployment (the surface does not exist there)
//
// SELF-HOSTED ONLY, OWNER ONLY — the same guards as fleet-repo pairing (`/api/org/local/pairing`), for
// the same reason: the body names a path on the server's filesystem. The filesystem probe runs only
// after the role gate, so an unauthorized caller cannot use this to ask whether a folder exists.
// No GitHub App is involved at any point; pairing it is the optional second step in the tab.

import { NextResponse } from "next/server";
import { resolveViewerLogin } from "@/lib/access";
import { selfHostGuard } from "@/lib/api/self-host";
import { guardRegistryRole, registryError } from "@/lib/registry/api";
import { pairLocalRegistry, unpairLocalRegistry, verifyLocalRegistry } from "@/lib/registry/local-registry";
import { resolveLocalRegistry } from "@/lib/registry/local-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const notHere = selfHostGuard();
  if (notHere) return notHere;
  const denied = await guardRegistryRole(slug, "owner");
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { path?: unknown; verifyOnly?: unknown };
  if (body.path === null) {
    const cleared = await unpairLocalRegistry(slug);
    if (!cleared) return registryError("not-mapped", "This organization has no registry to unpair.", 409);
    return NextResponse.json({ ok: true, paired: false });
  }

  const path =
    typeof body.path === "string" && body.path.trim() ? body.path.trim() : ((await resolveLocalRegistry())?.dir ?? "");
  if (!path) return registryError("invalid-input", "Provide the absolute `path` of the registry checkout.", 400);

  if (body.verifyOnly === true) {
    const check = await verifyLocalRegistry(path);
    return NextResponse.json({ ok: check.ok, paired: false, check });
  }

  const result = await pairLocalRegistry(slug, path, await resolveViewerLogin().catch(() => null));
  if (!result.ok) return NextResponse.json({ ok: false, check: result.check, error: result.error }, { status: 422 });
  const { index } = result;
  return NextResponse.json({
    ok: index.kind === "ok",
    paired: true,
    check: result.check,
    fullName: result.row.fullName,
    source: "local",
    ...(index.kind === "ok"
      ? { headSha: index.headSha, counts: index.counts, warnings: index.warnings ?? [] }
      : { error: `Paired, but the first index failed: ${index.message ?? "unknown error"}` }),
  });
}
