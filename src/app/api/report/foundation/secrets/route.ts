// POST   /api/report/foundation/secrets { org, repos: ["owner/name"], confirm } -> { results, tokenPrefix }
// DELETE /api/report/foundation/secrets { org, repos: ["owner/name"], confirm } -> { results, removed }
//
// Provision (and tear down) the report-back credentials that close the adopt→verify→re-score loop:
// with ASCENT_CONFORMANCE_URL + ASCENT_CONFORMANCE_TOKEN present, the foundation's CI workflow runs
// `node .ai/doctor.mjs --json` and POSTs its score to /api/report/conformance. Without them the doctor
// prints `reportSkipped` and Ascent never hears a thing — which is why "set these two secrets by hand"
// was the step most installs stopped at.
//
// This is the most dangerous write in the lane, and its gate is deliberately STRICTER than the PR
// routes beside it:
//
//  • **OWNER, not admin.** Writing a credential into a customer repo has a larger blast radius than a
//    draft PR, and it is the one action here that takes effect with no review step in between.
//  • **Typed confirmation of the full `owner/repo`.** One repo per confirmation — the `repos` array
//    exists so the panel can loop, not so one typed name can authorize a fleet-wide credential write.
//  • **The URL is derived SERVER-SIDE, never from the body.** A caller must not be able to point a
//    customer repo's CI at a host of their choosing; that would turn this route into a credential
//    exfiltration primitive.
//  • **Reversible.** DELETE removes both secrets AND revokes the token, so nothing Ascent wrote
//    survives it.
//  • **The raw token never enters an audit row** — only its `askl_`-prefixed display prefix, matching
//    org-api-tokens' capability model.

import { NextResponse } from "next/server";
import { AppApiError, isAppConfigured } from "@/lib/github/app";
import { isDbConfigured, recordOrgAudit } from "@/lib/db";
import { ensureOrgApiToken, revokeOrgApiTokensByName } from "@/lib/db/org-api-tokens";
import { PUBLIC_ORG, isAuthConfigured, requireSameOrigin, readableOrgForOwner } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
import { requireOrgRole } from "@/lib/authz";
import { classifyPrWriteError, requirePrWriteContext } from "@/lib/github/pr-route";
import { parseRepoUrl } from "@/lib/github/source";
import { CONFORMANCE_SECRETS, deleteRepoSecret, putRepoSecret } from "@/lib/github/actions-secrets";
import { publicBaseUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The one token name this route owns. Rotating by name is what keeps the written value knowable. */
const TOKEN_NAME = "conformance report-back";

interface SecretResult {
  repo: string;
  ok: boolean;
  error?: string;
}

interface Gated {
  org: string;
  owner: string;
  repo: string;
  fullName: string;
  actorLogin: string | null;
}

/**
 * The gate chain both verbs share, in order. Returns a ready-to-send Response on any refusal, so
 * neither handler can accidentally run half of it.
 */
async function gate(request: Request): Promise<Gated | Response> {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Provisioning report-back requires a database." }, { status: 503 });
  }
  if (!isAppConfigured()) {
    return NextResponse.json(
      { error: "Writing repository secrets needs the GitHub App installed with secrets write access." },
      { status: 503 },
    );
  }
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const actorLogin = await resolveViewerLogin();
  if ((authGateEnabled() || isAuthConfigured()) && !actorLogin) {
    return NextResponse.json({ error: "Sign in to provision report-back." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { org?: string; repos?: string[]; confirm?: string };
  if (!Array.isArray(body.repos) || body.repos.length === 0) {
    return NextResponse.json({ error: "Provide { org, repos: ['owner/name'], confirm }." }, { status: 400 });
  }
  const parsed = body.repos
    .map((raw) => parseRepoUrl(raw))
    .filter((r): r is NonNullable<ReturnType<typeof parseRepoUrl>> => !!r);
  const seen = new Set<string>();
  const unique = parsed.filter((r) => {
    const key = `${r.owner}/${r.repo}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length === 0) {
    return NextResponse.json({ error: "No valid 'owner/name' repos in the request." }, { status: 400 });
  }
  // ONE repo per typed confirmation. The array shape exists so the panel can loop one dialog per repo;
  // accepting several under a single confirmation would make the typed name theatre.
  if (unique.length > 1) {
    return NextResponse.json(
      { error: "Confirm one repository at a time: each secrets write needs its own typed confirmation." },
      { status: 400 },
    );
  }
  const target = unique[0]!;
  const fullName = `${target.owner}/${target.repo}`;

  const org = await readableOrgForOwner(target.owner);
  if (org === PUBLIC_ORG) {
    return NextResponse.json({ error: "Report-back is only for org-owned repositories." }, { status: 403 });
  }
  // A caller-supplied org may AGREE with the resolved one, never widen it.
  if (body.org && body.org.trim().toLowerCase() !== org.toLowerCase()) {
    return NextResponse.json({ error: "That repository doesn't belong to that org." }, { status: 403 });
  }
  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;

  // Typed confirmation LAST, so an unauthorized caller learns nothing from the phrasing of the 400.
  if ((body.confirm ?? "").trim() !== fullName) {
    return NextResponse.json(
      { error: `Confirmation required: set "confirm" to "${fullName}".` },
      { status: 400 },
    );
  }
  return { org, owner: target.owner, repo: target.repo, fullName, actorLogin };
}

/**
 * Where the repo's CI will POST its conformance report. Configured public origin first (in a
 * serverless deployment `request.url` can carry an internal host), else the request's own origin —
 * which is what makes a self-hosted install provision report-back to ITSELF with no configuration.
 * Never the request body: see the header.
 */
function conformanceUrl(request: Request): string {
  const base = publicBaseUrl() || new URL(request.url).origin;
  return `${base}/api/report/conformance`;
}

export async function POST(request: Request) {
  const g = await gate(request);
  if (g instanceof Response) return g;
  const { org, owner, repo, fullName, actorLogin } = g;

  try {
    const ctx = await requirePrWriteContext(org);
    if (ctx instanceof Response) return ctx;

    // ROTATE, always. A reused token's raw value is unrecoverable (only its hash is stored), so the
    // only way to be certain the value written into the repo is the one that works is to mint it here.
    // The previous token of this name is revoked in the same call.
    const minted = await ensureOrgApiToken(org, {
      name: TOKEN_NAME,
      scopes: ["telemetry:write"],
      createdBy: actorLogin,
      rotate: true,
    });
    if (!minted?.token) {
      return NextResponse.json({ error: "Couldn't mint a report-back token for this org." }, { status: 500 });
    }

    const results: SecretResult[] = [];
    try {
      await putRepoSecret(ctx.token, owner, repo, "ASCENT_CONFORMANCE_URL", conformanceUrl(request));
      await putRepoSecret(ctx.token, owner, repo, "ASCENT_CONFORMANCE_TOKEN", minted.token);
      results.push({ repo: fullName, ok: true });
    } catch (err) {
      const classified = classifyPrWriteError(err);
      results.push({
        repo: fullName,
        ok: false,
        error:
          classified?.status === 403
            ? "The installation lacks Secrets write access. Update the GitHub App's permissions."
            : (classified?.message ?? "Failed to write the repository secrets."),
      });
    }

    // The raw token is NEVER in the meta — only the display prefix, which is enough to recognize the
    // credential in the token list and useless as a bearer.
    await recordOrgAudit(
      "foundation.reportback_provisioned",
      org,
      {
        repo: fullName,
        tokenPrefix: minted.summary.tokenPrefix,
        secrets: [...CONFORMANCE_SECRETS],
        reusedToken: minted.reused,
        ok: results[0]!.ok,
      },
      actorLogin ?? undefined,
    );
    return NextResponse.json({ results, tokenPrefix: minted.summary.tokenPrefix });
  } catch (err) {
    if (err instanceof AppApiError) {
      return NextResponse.json({ error: "Failed to mint an installation token for this org." }, { status: 502 });
    }
    console.error("[foundation/secrets] POST failed", err);
    return NextResponse.json({ error: "Failed to provision report-back." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const g = await gate(request);
  if (g instanceof Response) return g;
  const { org, owner, repo, fullName, actorLogin } = g;

  try {
    const ctx = await requirePrWriteContext(org);
    if (ctx instanceof Response) return ctx;

    const results: SecretResult[] = [];
    let removed = 0;
    try {
      for (const name of CONFORMANCE_SECRETS) {
        await deleteRepoSecret(ctx.token, owner, repo, name);
        removed += 1;
      }
      results.push({ repo: fullName, ok: true });
    } catch (err) {
      const classified = classifyPrWriteError(err);
      results.push({ repo: fullName, ok: false, error: classified?.message ?? "Failed to remove the repository secrets." });
    }

    // Revoke the credential too, ALWAYS — including when the secret removal failed. Leaving a live
    // bearer token behind because a delete 403'd is the worse of the two failures: the secret can be
    // removed by hand in GitHub, but a token nobody knows about cannot be noticed.
    const revoked = await revokeOrgApiTokensByName(org, TOKEN_NAME);

    await recordOrgAudit(
      "foundation.reportback_revoked",
      org,
      { repo: fullName, secrets: [...CONFORMANCE_SECRETS], removed, tokensRevoked: revoked, ok: results[0]!.ok },
      actorLogin ?? undefined,
    );
    return NextResponse.json({ results, removed, tokensRevoked: revoked });
  } catch (err) {
    if (err instanceof AppApiError) {
      return NextResponse.json({ error: "Failed to mint an installation token for this org." }, { status: 502 });
    }
    console.error("[foundation/secrets] DELETE failed", err);
    return NextResponse.json({ error: "Failed to remove report-back." }, { status: 500 });
  }
}
