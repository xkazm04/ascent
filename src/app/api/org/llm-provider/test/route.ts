// POST /api/org/llm-provider/test { org, provider?, modelId?, region?, accessKeyId?, secretAccessKey?, apiKey? }
//   -> { ok, error? }
// Validate a BYOM connection (Feature 1) for EVERY supported provider: Bedrock (in-boundary), and the
// API-key kinds OpenRouter (fleet/cost path) and Nebius (hosted open-weight). Owner + BYOM-plan gated,
// same-origin. Uses the credentials in the body when present (so an org can TEST before saving /
// enabling), else the stored (decrypted) secret, supporting the save → test → enable flow. Runs ONE
// cheap but SCHEMA-SHAPED provider call (see testBedrockConnection / json-mode-probe.ts: a bare ping green-checks configs that fail every
// real scan) and stamps lastValidatedAt/Error. The secret is never echoed back; the error message is
// sanitized + bounded. The shared "public" org is refused (refusePublicOrgAdmin): nobody owns its
// provider config, so nobody may probe it or stamp its validation columns (security scan 2026-10-07).

import { NextResponse } from "next/server";
import { getCreditState, getOrgLlmConfig, isDbConfigured, recordOrgLlmValidation } from "@/lib/db";
import { getStoredByomSecret } from "@/lib/db/org-llm";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { refusePublicOrgAdmin } from "@/lib/authz";
import { planAllowsByom } from "@/lib/plans";
import { isEncryptionConfigured } from "@/lib/crypto/secret-box";
import { isValidAwsRegion, REGION_FORMAT_ERROR, testBedrockConnection } from "@/lib/llm/bedrock";
import { testOpenRouterConnection } from "@/lib/llm/openrouter";
import { testNebiusConnection } from "@/lib/llm/nebius";
import { isApiKeyByomKind, type ApiKeyByomKind } from "@/lib/llm/byom-kinds";

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
  const publicRefused = refusePublicOrgAdmin(org);
  if (publicRefused) return publicRefused;
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

  const result = isApiKeyByomKind(provider)
    ? await testApiKeyKind(provider, org, model, body)
    : await testBedrock(org, model, body, stored?.region ?? undefined);
  if (result instanceof NextResponse) return result;

  await recordOrgLlmValidation(org, result.ok, result.error).catch(() => {});
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

/** Each API-key kind's vendor name (for the "enter your key" hint) and its connection probe. */
const API_KEY_TESTERS: Record<
  ApiKeyByomKind,
  { label: string; test(opts: { model: string; apiKey: string }): Promise<{ ok: boolean; error?: string }> }
> = {
  openrouter: { label: "OpenRouter", test: testOpenRouterConnection },
  nebius: { label: "Nebius", test: testNebiusConnection },
};

async function testApiKeyKind(kind: ApiKeyByomKind, org: string, model: string, body: TestBody) {
  const typed = body.apiKey?.trim();
  // A stored key only comes back when the SAVED provider is this same kind: the union-typed accessor
  // makes a cross-provider read impossible, so an OpenRouter key is never sent to Nebius (or back).
  const apiKey = typed || (await storedApiKey(org, kind));
  const tester = API_KEY_TESTERS[kind];
  if (!apiKey) {
    return NextResponse.json({ error: `No API key to test. Enter your ${tester.label} key first.` }, { status: 400 });
  }
  return tester.test({ model, apiKey });
}

async function storedApiKey(org: string, kind: ApiKeyByomKind): Promise<string | null> {
  const secret = await getStoredByomSecret(org);
  return secret?.provider === kind ? secret.apiKey : null;
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
  // The region is checked BEFORE the credential lookup: it is a pure format question, and refusing it
  // first means a malformed region never costs a decrypt. BOTH sources are checked — a region saved
  // before this grammar existed is refused here too, which is the behaviour change the operator
  // accepted when closing scan F3: it must be re-typed to be testable. A clean 400 at the door, never
  // a 500 out of resolveBedrockRegion, and never a SigV4-signed call to a caller-chosen host.
  const region = body.region?.trim() || storedRegion || undefined;
  if (region !== undefined && !isValidAwsRegion(region)) {
    return NextResponse.json({ error: REGION_FORMAT_ERROR }, { status: 400 });
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
  return testBedrockConnection({ model, region, credentials });
}
