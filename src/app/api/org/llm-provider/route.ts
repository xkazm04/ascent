// GET    /api/org/llm-provider?org=  -> { config, planAllowed, encryptionConfigured }   (owner)
// POST   /api/org/llm-provider { org, modelId, region?, authMode?, enabled?, accessKeyId?, secretAccessKey? }
// DELETE /api/org/llm-provider { org }  -> { ok }  (disable + clear creds)
// BYOM (Feature 1) — connect an org's own Amazon Bedrock. Owner-gated, same-origin, Enterprise-plan
// gated, and fail-closed without ENCRYPTION_KEY. The GET response NEVER includes the secret (only
// `hasCredentials`); the secret is encrypted at rest and decrypted only at provider-construction time.

import { NextResponse } from "next/server";
import {
  disableOrgLlmConfig,
  getCreditState,
  getOrgId,
  getOrgLlmConfig,
  isDbConfigured,
  recordAudit,
  setOrgLlmConfig,
} from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { getSession, isSameOrigin } from "@/lib/auth";
import { planAllowsByom } from "@/lib/plans";
import { isEncryptionConfigured } from "@/lib/crypto/secret-box";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "BYOM requires a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;
  const config = await getOrgLlmConfig(org);
  const credit = await getCreditState(org).catch(() => null);
  return NextResponse.json({
    config, // secret-free metadata (hasCredentials only) or null
    planAllowed: planAllowsByom(credit?.plan),
    encryptionConfigured: isEncryptionConfigured(),
  });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "BYOM requires a database." }, { status: 503 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    modelId?: string;
    region?: string;
    authMode?: string;
    enabled?: boolean;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  if (!body.org || !body.modelId?.trim()) {
    return NextResponse.json({ error: "Provide { org, modelId }." }, { status: 400 });
  }
  const denied = await requireOrgRole(body.org, "owner");
  if (denied) return denied;
  // Enterprise-only entitlement (§8.4).
  const credit = await getCreditState(body.org).catch(() => null);
  if (!planAllowsByom(credit?.plan)) {
    return NextResponse.json({ error: "BYOM is an Enterprise-plan feature." }, { status: 403 });
  }
  // Fail closed: persisting a customer secret requires the encryption key.
  if (!isEncryptionConfigured()) {
    return NextResponse.json({ error: "Secret encryption is not configured on this deployment (set ENCRYPTION_KEY)." }, { status: 409 });
  }
  const session = await getSession();
  const res = await setOrgLlmConfig(
    body.org,
    {
      modelId: body.modelId,
      region: body.region,
      authMode: body.authMode,
      enabled: body.enabled,
      accessKeyId: body.accessKeyId,
      secretAccessKey: body.secretAccessKey,
    },
    session?.login ?? null,
  );
  if (!res.ok) return NextResponse.json({ error: res.error ?? "Failed to save." }, { status: 400 });
  const orgId = (await getOrgId(body.org.toLowerCase()).catch(() => null)) ?? undefined;
  // Audit the config change WITHOUT the secret — model/region/enabled + whether creds were rotated.
  await recordAudit(
    "org.llm_provider.updated",
    { provider: "bedrock", modelId: body.modelId.trim(), region: body.region ?? null, enabled: body.enabled ?? false, credsRotated: Boolean(body.accessKeyId) },
    { orgId, actorId: session?.login },
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "BYOM requires a database." }, { status: 503 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { org?: string };
  if (!body.org) return NextResponse.json({ error: "Provide { org }." }, { status: 400 });
  const denied = await requireOrgRole(body.org, "owner");
  if (denied) return denied;
  await disableOrgLlmConfig(body.org);
  const session = await getSession();
  const orgId = (await getOrgId(body.org.toLowerCase()).catch(() => null)) ?? undefined;
  await recordAudit("org.llm_provider.disabled", { provider: "bedrock" }, { orgId, actorId: session?.login });
  return NextResponse.json({ ok: true });
}
