// POST /api/org/:slug/registry/signals { confirm: "contribute" } -> publish signals/<contributor>.json
//
// The one place in #18 where data leaves the deployment, and into a repo the customer may have made
// public. It is therefore gated FOUR ways and off by default:
//
//   1. `guardRegistryWrite` — org admin, an installed App, a mintable installation token.
//   2. `isSameOrigin` — publication is state-changing and must not be reachable cross-site.
//   3. the registry's own spine declares ascent a WRITER of the `signals` lane, and its telemetry
//      sink is `registry`. Both live in the customer's repo, so the customer — not ascent — decides
//      that this lane may be written at all. The spine is re-read here rather than trusted from a
//      cached row: it is the authority, and it may have changed since the last index pass.
//   4. a typed confirm (`"contribute"`), because this is publication and no button press should be
//      one misclick away from a commit in someone else's repo.
//
// The audit row is written BEFORE the GitHub call. An attempt to publish is the auditable act;
// recording only successes would hide exactly the cases anyone would later want to look at.

import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { getOrgId } from "@/lib/db/org-rollup";
import { getOrgRegistry } from "@/lib/db/org-registry";
import { guardRegistryWrite, githubErrorResponse, registryError } from "@/lib/registry/api";
import {
  getSignalsContributor,
  listRegistrySignals,
  recordSignalContribution,
  setSignalContributionResult,
} from "@/lib/db/org-registry-signals";
import { listConformanceMaps } from "@/lib/db/org-registry-conformance";
import { readRegistrySpine } from "@/lib/registry/conformance-read";
import { parseRegistryYaml, writesLane } from "@/lib/registry/policy";
import { parseFullName, REGISTRY_DIRS } from "@/lib/registry/layout";
import { summarizeSignals } from "@/lib/registry/signals";
import {
  assertNoLeaks,
  buildSignalsPayload,
  deriveContributorId,
  isValidContributor,
} from "@/lib/registry/signals-contribution";
import { openOrUpdateSignalsPr } from "@/lib/registry/signals-pr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIRM = "contribute";
const WINDOW_DAYS = 30;

export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!isSameOrigin(request)) return registryError("not-permitted", "Cross-origin request refused.", 403);

  const gate = await guardRegistryWrite(slug);
  if (gate instanceof NextResponse) return gate;

  const body = (await request.json().catch(() => ({}))) as { confirm?: unknown };
  if (body.confirm !== CONFIRM) {
    return registryError("invalid-input", `Type "${CONFIRM}" to publish signals to your registry.`, 400);
  }

  const [registry, orgId] = await Promise.all([getOrgRegistry(slug).catch(() => null), getOrgId(slug).catch(() => null)]);
  if (!registry || !orgId) return registryError("not-mapped", "This organization has no registry mapped yet.", 409);
  if (registry.telemetrySink !== "registry") {
    return registryError(
      "not-permitted",
      "This registry's telemetry sink is not `registry`. Set it in .ascent/registry.yaml first.",
      403,
    );
  }
  const ref = parseFullName(registry.fullName);
  if (!ref) return registryError("invalid-input", `"${registry.fullName}" is not a valid repository name.`, 400);

  // The spine decides. Re-read rather than trusted from the indexed row — the customer may have
  // revoked the lane since, and a cached "yes" would publish against a live "no".
  let spine: string | null;
  try {
    spine = await readRegistrySpine(gate.token, ref.owner, ref.repo);
  } catch (err) {
    return githubErrorResponse(err);
  }
  if (!spine || !writesLane(parseRegistryYaml(spine), REGISTRY_DIRS.signals)) {
    return registryError(
      "not-permitted",
      "Your registry does not declare ascent a writer of the `signals` lane. Add it to .ascent/registry.yaml.",
      403,
    );
  }

  const contributor = (await getSignalsContributor(registry.id).catch(() => null)) || deriveContributorId(orgId, registry.id);
  if (!isValidContributor(contributor)) {
    // Refused rather than slugified: slugifying `acme/dev` into `acme-dev` would publish an org name.
    return registryError("invalid-input", "The configured contributor id is not [a-z0-9-]{3,64}.", 400);
  }

  // The payload is built from what ascent has MEASURED, fleet-wide and un-attributed: the signals
  // rows others contributed are not re-published, and the conformance evidence — the most useful
  // thing here — never travels, because it is a fact about one tree.
  const [signalRows, maps] = await Promise.all([listRegistrySignals(orgId), listConformanceMaps(orgId)]);
  const deviationsTotal = maps.reduce((n, m) => n + m.deviations, 0);
  const subjects = summarizeSignals(signalRows).map((s) => ({
    bundle: s.bundle,
    subjectSlug: s.subjectSlug,
    consults: s.consults,
    deviations: s.deviations,
    citations: { resolved: s.citResolved, moved: s.citMoved, gone: s.citGone },
  }));
  if (!subjects.length) {
    return registryError("no-op", "There is nothing measured to contribute yet.", 409);
  }

  const payload = buildSignalsPayload({
    contributor,
    windowDays: WINDOW_DAYS,
    generatedAt: new Date().toISOString(),
    subjects,
  });
  const leak = assertNoLeaks(payload.body);
  if (!leak.ok) return registryError("invalid-input", leak.reason, 400);

  const path = `${REGISTRY_DIRS.signals}/${contributor}.json`;
  const attemptId = await recordSignalContribution({
    orgId,
    registryId: registry.id,
    contributor,
    payloadDigest: payload.digest,
    bundles: Array.from(new Set(subjects.map((s) => s.bundle))),
    subjects: payload.subjects,
    deviations: deviationsTotal,
    // resolveViewerLogin, not getSession: under the Supabase wall the dormant custom-OAuth session
    // is null, and an audit row with a null actor is the one field it cannot afford to lose.
    actor: (await resolveViewerLogin().catch(() => null)) ?? "unknown",
  }).catch(() => null);

  try {
    const pr = await openOrUpdateSignalsPr({
      token: gate.token,
      owner: ref.owner,
      repo: ref.repo,
      base: registry.defaultBranch || undefined,
      path,
      content: payload.body,
      commitMessage: `signals: ${contributor} — ${payload.subjects} subjects (${WINDOW_DAYS}d)`,
      prTitle: `signals: contribution from ${contributor}`,
      prBody:
        "Counts only — no repository names, no paths, no `file:line`, no logins. " +
        "Generated by Ascent from this organization's own conformance and consult signals. " +
        "Merging this is the act of accepting the contribution.",
    });
    if (attemptId) await setSignalContributionResult(attemptId, { prUrl: pr.url, commitSha: pr.commitSha });
    return NextResponse.json({ url: pr.url, number: pr.number, branch: pr.branch, reused: pr.reused, updated: pr.updated, subjects: payload.subjects });
  } catch (err) {
    // The attempt row stays exactly as written — a failed publish is part of the audit trail.
    return githubErrorResponse(err);
  }
}
