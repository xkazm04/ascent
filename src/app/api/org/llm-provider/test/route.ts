// POST /api/org/llm-provider/test { org, modelId?, region?, accessKeyId?, secretAccessKey? } -> { ok, error? }
// Validate a BYOM Bedrock connection (Feature 1). Owner + Enterprise gated, same-origin. Uses the
// credentials in the body when present (so an org can TEST before saving / enabling), else the stored
// (decrypted) creds — supporting the save → test → enable flow. Runs ONE cheap Bedrock ping and stamps
// lastValidatedAt/Error. The secret is never echoed back; the error message is sanitized + bounded.

import { NextResponse } from "next/server";
import { getCreditState, getOrgLlmConfig, isDbConfigured, recordOrgLlmValidation } from "@/lib/db";
import { getStoredByomCredentials } from "@/lib/db/org-llm";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { planAllowsByom } from "@/lib/plans";
import { isEncryptionConfigured } from "@/lib/crypto/secret-box";
import { testBedrockConnection } from "@/lib/llm/bedrock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "BYOM requires a database." }, { status: 503 });
  const gate = await requireOrgOwnerPost<{ modelId?: string; region?: string; accessKeyId?: string; secretAccessKey?: string }>(request);
  if (gate instanceof NextResponse) return gate;
  const { org, body } = gate;
  const credit = await getCreditState(org).catch(() => null);
  if (!planAllowsByom(credit?.plan)) {
    return NextResponse.json({ error: "BYOM is an Enterprise-plan feature." }, { status: 403 });
  }
  if (!isEncryptionConfigured()) {
    return NextResponse.json({ error: "Secret encryption is not configured (set ENCRYPTION_KEY)." }, { status: 409 });
  }

  const hasKeyId = Boolean(body.accessKeyId?.trim());
  const hasSecret = Boolean(body.secretAccessKey?.trim());
  if (hasKeyId !== hasSecret) {
    return NextResponse.json({ error: "Provide both accessKeyId and secretAccessKey, or neither (to test saved keys)." }, { status: 400 });
  }
  const credentials =
    hasKeyId && hasSecret
      ? { accessKeyId: body.accessKeyId!.trim(), secretAccessKey: body.secretAccessKey!.trim() }
      : await getStoredByomCredentials(org);
  if (!credentials) {
    return NextResponse.json({ error: "No credentials to test — enter your AWS keys first." }, { status: 400 });
  }

  const stored = await getOrgLlmConfig(org);
  const model = body.modelId?.trim() || stored?.modelId;
  const region = body.region?.trim() || stored?.region || undefined;
  if (!model) return NextResponse.json({ error: "Provide a modelId." }, { status: 400 });

  const result = await testBedrockConnection({ model, region, credentials });
  await recordOrgLlmValidation(org, result.ok, result.error).catch(() => {});
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
