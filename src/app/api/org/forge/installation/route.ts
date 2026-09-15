// GET    /api/org/forge/installation?org=            -> { installations, encryptionConfigured }
// POST   /api/org/forge/installation { org, forge, externalId, host?, credential? }
// DELETE /api/org/forge/installation { org, forge, externalId }
//
// FORGE-NEUTRAL INGESTION (moonshot #4) — connect an org's GitLab account (a group access token or a
// PAT), or a self-managed instance.
//
// Three properties, each deliberate:
//  - **No `[id]` route.** The row is addressed by `(org, forge, externalId)`, all of which are gated
//    or supplied together, so there is no caller-supplied id to authorize against a row's org.
//    `id-routes-gated.test.ts` is untouched by design, not by omission.
//  - **The credential is write-only over HTTP.** GET returns `hasCredential`, never the secret and
//    never its ciphertext — the wire type has no field for it (see `ForgeInstallationRow`).
//  - **Fail CLOSED without ENCRYPTION_KEY.** A deployment that cannot encrypt refuses to store a
//    customer credential rather than persisting one in the clear. Same rule as BYOM.
//
// `Organization.githubInstallId` is untouched: GitHub keeps its existing installation path, and this
// table sits beside it.

import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db";
import {
  deleteForgeInstallation,
  listForgeInstallations,
  upsertForgeInstallation,
} from "@/lib/db/forge-installations";
import { requireOrgRole } from "@/lib/authz";
import { requireSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { isEncryptionConfigured } from "@/lib/crypto/secret-box";
import { isForgeId, type ForgeId } from "@/lib/forge/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GitHub is never connected here — it has its own installation flow, and offering it on this form
 *  would present two competing sources of truth for one org's GitHub access. */
function readForge(v: unknown): ForgeId | null {
  return isForgeId(v) && v !== "github" && v !== "local" ? v : null;
}

/** The forge-native account handle. Kept to a conservative charset (a GitLab group path or numeric
 *  id) because it is interpolated into an API path by the adapters. */
function readExternalId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > 200) return null;
  if (!/^[A-Za-z0-9_./-]+$/.test(s) || s.includes("..") || s.startsWith(".")) return null;
  return s;
}

/** A self-managed instance's web root. https only — a credential must not be sent over plaintext. */
function readHost(v: unknown): string | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return "invalid";
  try {
    const url = new URL(v.trim());
    if (url.protocol !== "https:") return "invalid";
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "invalid";
  }
}

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Forge installations require a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRole(org, "admin");
  if (denied) return denied;
  return NextResponse.json({
    installations: await listForgeInstallations(org),
    encryptionConfigured: isEncryptionConfigured(),
  });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Forge installations require a database." }, { status: 503 });
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    forge?: string;
    externalId?: string;
    host?: string | null;
    credential?: string | null;
  };
  if (!body.org) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  const denied = await requireOrgRole(body.org, "admin");
  if (denied) return denied;

  const forge = readForge(body.forge);
  if (!forge) return NextResponse.json({ error: "Unsupported forge. GitLab is the only connectable forge." }, { status: 400 });
  const externalId = readExternalId(body.externalId);
  if (!externalId) return NextResponse.json({ error: "Provide a valid group path or project id." }, { status: 400 });
  const host = readHost(body.host);
  if (host === "invalid") return NextResponse.json({ error: "Host must be an https URL." }, { status: 400 });
  if (body.credential && !isEncryptionConfigured()) {
    return NextResponse.json(
      { error: "Secret encryption is not configured on this deployment (set ENCRYPTION_KEY)." },
      { status: 409 },
    );
  }

  const actorId = (await resolveViewerLogin()) ?? undefined;
  const row = await upsertForgeInstallation({
    orgSlug: body.org,
    forge,
    externalId,
    host,
    // `undefined` leaves an existing credential in place (renaming a host must not require re-pasting
    // a token); an explicit `null` clears it.
    ...(body.credential === undefined ? {} : { credential: body.credential || null }),
    ...(actorId ? { actorId } : {}),
  });
  return NextResponse.json({ installation: row });
}

export async function DELETE(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Forge installations require a database." }, { status: 503 });
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const body = (await request.json().catch(() => ({}))) as { org?: string; forge?: string; externalId?: string };
  if (!body.org) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  const denied = await requireOrgRole(body.org, "admin");
  if (denied) return denied;
  const forge = readForge(body.forge);
  const externalId = readExternalId(body.externalId);
  if (!forge || !externalId) return NextResponse.json({ error: "Provide { forge, externalId }." }, { status: 400 });
  const actorId = (await resolveViewerLogin()) ?? undefined;
  const removed = await deleteForgeInstallation(body.org, forge, externalId, actorId ? { actorId } : {});
  return NextResponse.json({ ok: removed });
}
