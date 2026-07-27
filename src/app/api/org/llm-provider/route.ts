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
  getOrgLlmConfig,
  isDbConfigured,
  recordOrgAudit,
  setOrgLlmConfig,
} from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { isSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
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
    provider?: string;
    modelId?: string;
    region?: string;
    authMode?: string;
    enabled?: boolean;
    accessKeyId?: string;
    secretAccessKey?: string;
    apiKey?: string;
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
  // resolveViewerLogin, not the dormant session: the custom-OAuth session is null under the ACTIVE
  // Supabase wall, so this actor/audit row was recorded as null in production.
  const actorLogin = await resolveViewerLogin();
  const provider = body.provider?.trim() || "bedrock";
  const res = await setOrgLlmConfig(
    body.org,
    {
      provider,
      modelId: body.modelId,
      region: body.region,
      authMode: body.authMode,
      enabled: body.enabled,
      accessKeyId: body.accessKeyId,
      secretAccessKey: body.secretAccessKey,
      apiKey: body.apiKey,
    },
    actorLogin,
  );
  if (!res.ok) return NextResponse.json({ error: res.error ?? "Failed to save." }, { status: 400 });
  // Audit the config change WITHOUT the secret — provider/model/region/enabled + whether creds rotated.
  await recordOrgAudit(
    "org.llm_provider.updated",
    body.org,
    { provider, modelId: body.modelId.trim(), region: body.region ?? null, enabled: body.enabled ?? false, credsRotated: Boolean(body.accessKeyId || body.apiKey) },
    actorLogin ?? undefined,
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
  // Read the config BEFORE disabling: the audit row must name the provider that was actually
  // configured. It was hardcoded to "bedrock", so every OpenRouter disable was audited as a Bedrock
  // disable — a compliance log that misstates which vendor stopped receiving the org's code.
  const configured = (await getOrgLlmConfig(body.org).catch(() => null))?.provider ?? null;
  await disableOrgLlmConfig(body.org);
  // resolveViewerLogin, not the dormant session: the custom-OAuth session is null under the ACTIVE
  // Supabase wall, so this actor/audit row was recorded as null in production.
  const actorLogin = await resolveViewerLogin();
  await recordOrgAudit("org.llm_provider.disabled", body.org, { provider: configured }, actorLogin ?? undefined);
  return NextResponse.json({ ok: true });
}
