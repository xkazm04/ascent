// POST /api/org/llm-provider/test { org, provider?, modelId?, region?, accessKeyId?, secretAccessKey?, apiKey? }
//   -> { ok, error? }
// Validate a BYOM connection (Feature 1) for EITHER supported provider — Bedrock (in-boundary) or
// OpenRouter (fleet/cost path). Owner + Enterprise gated, same-origin. Uses the credentials in the body
// when present (so an org can TEST before saving / enabling), else the stored (decrypted) secret —
// supporting the save → test → enable flow. Runs ONE cheap but SCHEMA-SHAPED provider call (see
// testBedrockConnection / testOpenRouterConnection: a bare ping green-checks configs that fail every
// real scan) and stamps lastValidatedAt/Error. The secret is never echoed back; the error message is
// sanitized + bounded.

import { NextResponse } from "next/server";
import { getCreditState, getOrgLlmConfig, isDbConfigured, recordOrgLlmValidation } from "@/lib/db";
import { getStoredByomSecret } from "@/lib/db/org-llm";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { planAllowsByom } from "@/lib/plans";
import { isEncryptionConfigured } from "@/lib/crypto/secret-box";
import { testBedrockConnection } from "@/lib/llm/bedrock";
import { testOpenRouterConnection } from "@/lib/llm/openrouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TestBody {
  provider?: string;
  modelId?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  apiKey?: string;
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "BYOM requires a database." }, { status: 503 });
  const gate = await requireOrgOwnerPost<TestBody>(request);
  if (gate instanceof NextResponse) return gate;
  const { org, body } = gate;
  const credit = await getCreditState(org).catch(() => null);
  if (!planAllowsByom(credit?.plan)) {
    return NextResponse.json({ error: "BYOM is an Enterprise-plan feature." }, { status: 403 });
  }
  if (!isEncryptionConfigured()) {
    return NextResponse.json({ error: "Secret encryption is not configured (set ENCRYPTION_KEY)." }, { status: 409 });
  }

  const stored = await getOrgLlmConfig(org);
  // Which provider is under test: what the card says, else what's saved, else the Bedrock default —
  // so a test fired from the OpenRouter card can never be validated against Bedrock (or vice-versa).
  const provider = body.provider?.trim() || stored?.provider || "bedrock";
  const model = body.modelId?.trim() || stored?.modelId;
  if (!model) return NextResponse.json({ error: "Provide a modelId." }, { status: 400 });

  const result =
    provider === "openrouter"
      ? await testOpenRouter(org, model, body)
      : await testBedrock(org, model, body, stored?.region ?? undefined);
  if (result instanceof NextResponse) return result;

  await recordOrgLlmValidation(org, result.ok, result.error).catch(() => {});
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

async function testOpenRouter(org: string, model: string, body: TestBody) {
  const typed = body.apiKey?.trim();
  // A stored OpenRouter key only comes back when the SAVED provider is openrouter — the union-typed
  // accessor makes a cross-provider read impossible rather than silently null.
  const apiKey = typed || (await storedOpenRouterKey(org));
  if (!apiKey) {
    return NextResponse.json({ error: "No API key to test. Enter your OpenRouter key first." }, { status: 400 });
  }
  return testOpenRouterConnection({ model, apiKey });
}

async function storedOpenRouterKey(org: string): Promise<string | null> {
  const secret = await getStoredByomSecret(org);
  return secret?.provider === "openrouter" ? secret.apiKey : null;
}

async function testBedrock(org: string, model: string, body: TestBody, storedRegion: string | undefined) {
  const hasKeyId = Boolean(body.accessKeyId?.trim());
  const hasSecret = Boolean(body.secretAccessKey?.trim());
  if (hasKeyId !== hasSecret) {
    return NextResponse.json(
      { error: "Provide both accessKeyId and secretAccessKey, or neither (to test saved keys)." },
      { status: 400 },
    );
  }
  let credentials: { accessKeyId: string; secretAccessKey: string } | null =
    hasKeyId && hasSecret
      ? { accessKeyId: body.accessKeyId!.trim(), secretAccessKey: body.secretAccessKey!.trim() }
      : null;
  if (!credentials) {
    const secret = await getStoredByomSecret(org);
    credentials = secret?.provider === "bedrock" ? secret.credentials : null;
  }
  if (!credentials) {
    return NextResponse.json({ error: "No credentials to test. Enter your AWS keys first." }, { status: 400 });
  }
  const region = body.region?.trim() || storedRegion || undefined;
  return testBedrockConnection({ model, region, credentials });
}
