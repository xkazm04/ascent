// GET    /api/integrations/openai?org=                     -> { connection, encryptionConfigured }
// PUT    /api/integrations/openai { org, adminKey?, projectIds? } -> { connection }
// DELETE /api/integrations/openai { org }                   -> { ok }
//
// Custody of the org's OpenAI ADMIN key for the Costs connector (sync: ./sync/route.ts).
//
//  - **Owner-only, every verb.** The key reads the org's whole OpenAI bill; managing it is the same
//    privilege as the Integrations tab itself. Writes are also same-origin.
//  - **Write-only over HTTP.** No response carries the key or its ciphertext: the wire row
//    (`ProviderConnectionRow`) has no field for either. A rejected key is not echoed back either.
//  - **Fail CLOSED without ENCRYPTION_KEY** (409), the rule forge installations and BYOM follow.
//  - **No `[id]` route.** The row is addressed by (org, provider) and the org is gated.

import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db";
import {
  deleteProviderConnection,
  getProviderConnection,
  setProviderConnection,
} from "@/lib/db/provider-credentials";
import { refusePublicOrgAdmin, requireOrgRole } from "@/lib/authz";
import { requireSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { isEncryptionConfigured } from "@/lib/crypto/secret-box";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_DB = { error: "The OpenAI connector requires a database." };

/** An OpenAI organization Admin key. Project (`sk-proj-`) and service-account keys cannot read the
 *  Costs API, so accepting one would only defer the failure to the first sync. */
function readAdminKey(v: unknown): string | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return "invalid";
  const s = v.trim();
  if (s.length < 20 || s.length > 512 || /\s/.test(s) || !s.startsWith("sk-admin-")) return "invalid";
  return s;
}

/** OpenAI project ids (`proj_...`). Bounded, because each becomes a query parameter. */
function readProjectIds(v: unknown): string[] | undefined | "invalid" {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 50) return "invalid";
  const ids = v.map((x) => (typeof x === "string" ? x.trim() : ""));
  if (ids.some((x) => !/^proj_[A-Za-z0-9_-]{1,64}$/.test(x))) return "invalid";
  return [...new Set(ids)];
}

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json(NO_DB, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;
  return NextResponse.json({
    connection: await getProviderConnection(org, "openai"),
    encryptionConfigured: isEncryptionConfigured(),
  });
}

export async function PUT(request: Request) {
  if (!isDbConfigured()) return NextResponse.json(NO_DB, { status: 503 });
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const body = (await request.json().catch(() => ({}))) as { org?: string; adminKey?: unknown; projectIds?: unknown };
  if (!body.org) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  const denied = refusePublicOrgAdmin(body.org) ?? (await requireOrgRole(body.org, "owner"));
  if (denied) return denied;

  const adminKey = readAdminKey(body.adminKey);
  if (adminKey === "invalid") {
    return NextResponse.json(
      { error: "That is not an OpenAI organization Admin key. Create one under Organization settings, Admin keys (it starts sk-admin-)." },
      { status: 400 },
    );
  }
  const projectIds = readProjectIds(body.projectIds);
  if (projectIds === "invalid") {
    return NextResponse.json({ error: "Project ids must be OpenAI project ids (proj_...), at most 50." }, { status: 400 });
  }
  const existing = await getProviderConnection(body.org, "openai");
  if (!adminKey && !existing?.hasCredential) {
    return NextResponse.json({ error: "Provide the OpenAI admin key to connect." }, { status: 400 });
  }
  if (adminKey && !isEncryptionConfigured()) {
    return NextResponse.json(
      { error: "Secret encryption is not configured on this deployment (set ENCRYPTION_KEY), so the key cannot be stored." },
      { status: 409 },
    );
  }

  const actorId = (await resolveViewerLogin()) ?? undefined;
  const connection = await setProviderConnection({
    orgSlug: body.org,
    provider: "openai",
    ...(adminKey ? { credential: adminKey } : {}),
    ...(projectIds === undefined ? {} : { projectIds }),
    ...(actorId ? { actorId } : {}),
  });
  if (!connection) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  return NextResponse.json({ connection });
}

export async function DELETE(request: Request) {
  if (!isDbConfigured()) return NextResponse.json(NO_DB, { status: 503 });
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const body = (await request.json().catch(() => ({}))) as { org?: string };
  if (!body.org) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  const denied = refusePublicOrgAdmin(body.org) ?? (await requireOrgRole(body.org, "owner"));
  if (denied) return denied;
  const actorId = (await resolveViewerLogin()) ?? undefined;
  const ok = await deleteProviderConnection(body.org, "openai", actorId ? { actorId } : {});
  return NextResponse.json({ ok });
}
