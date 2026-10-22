// Control-probe fan-in (moonshot #10) and the control attribution (moonshot #1), moved from
// src/app/api/app/webhook/route.ts (challenge-2026-10-22d github-app-0).
//
// Five events change a repo's CONTROL posture without changing a line of code: branch_protection_rule,
// repository_ruleset, repository, member, team. THE PAYLOAD IS NEVER TRUSTED FOR CONTROL STATE: a
// `branch_protection_rule.deleted` delivery means "re-read this repo", never "protection is off". Only
// the probe's own re-read from GitHub produces an observation. The work is a QUEUED JOB, and the
// delivery id is the idempotency bucket, so a redelivery enqueues nothing new.
//
// The bind: each arm binds ONCE, and the probe, the unwatch and the attribution all take that one
// BoundDelivery. A refused bind used to release the delivery and return void, so the attribution
// that followed still wrote an actor-attributed row into the named org's ledger. It now writes nothing.

import { listWatchedRepos, reconcileWatchedRepos } from "@/lib/db";
import { enqueueProbeJob, resolveRepoJobRef } from "@/lib/db/scan-jobs";
import { GOVERNANCE_EVENTS, normalizeGovernanceEvent } from "@/lib/github/governance-events";
import { latestObservations, recordObservations, type ControlSample } from "@/lib/db/control-observations";
import { abandonDelivery } from "@/lib/github/webhook-delivery";
import { bindDelivery, type BoundDelivery } from "./owner-bind";
import type { WebhookPayload } from "./payload";

/** Cap on the org-wide fan-out of an owner-level event; the hourly cadence catches the tail. */
export const ORG_EVENT_PROBE_CAP = 200;

/** A repo-scoped control event: bind once, then probe (and unwatch a deleted repo), then attribute. */
export async function runRepoControlArm(
  installationId: number,
  owner: string,
  fullName: string,
  event: string,
  payload: WebhookPayload,
  deliveryId?: string,
): Promise<void> {
  const bound = await bindDelivery(installationId, owner.toLowerCase(), deliveryId);
  if (!bound) return;
  await enqueueControlProbe(bound, fullName, event, payload.action);
  // The probe re-reads the truth; only the delivery knows the actor, and the attribution row asserts
  // no state of its own.
  if (GOVERNANCE_EVENTS.includes(event)) await recordControlAttribution(bound, fullName, event, payload);
}

/** An owner-level control event (`member`, `team`): one repo when named, else the org's watched repos. */
export async function runOrgControlArm(
  installationId: number,
  owner: string,
  event: string,
  repoFullName: string | undefined,
  deliveryId?: string,
): Promise<void> {
  const bound = await bindDelivery(installationId, owner.toLowerCase(), deliveryId);
  if (!bound) return;
  if (repoFullName) {
    await enqueueControlProbe(bound, repoFullName, event);
    return;
  }
  const repos = await listWatchedRepos(bound.orgSlug).catch(() => []);
  for (const r of repos.slice(0, ORG_EVENT_PROBE_CAP)) {
    await enqueueProbeJob(bound.orgSlug, r.fullName, `webhook:${event}`, bound.deliveryId).catch(() => null);
  }
}

async function enqueueControlProbe(bound: BoundDelivery, fullName: string, event: string, action?: string): Promise<void> {
  // repository.deleted is GitHub confirming this fullName is gone. Unwatch it with the same
  // reconcileWatchedRepos drop used when a repo leaves the installation set - that fullName only.
  // Archived stays watched.
  if (event === "repository" && action === "deleted") await unwatchDeletedFullName(bound, fullName);
  await enqueueProbeJob(bound.orgSlug, fullName, `webhook:${event}`, bound.deliveryId).catch((err) => {
    console.warn(`[webhook] could not enqueue a control probe for ${fullName}`, err instanceof Error ? err.message : err);
    return null;
  });
}

/**
 * Unwatch one gone repo. Only calls reconcileWatchedRepos when `fullName` is currently watched, so an
 * empty remaining list means "that was the last watched repo" - never a failed listing passed off as
 * "zero live repos" (which would unwatch the whole installation).
 */
async function unwatchDeletedFullName(bound: BoundDelivery, fullName: string): Promise<void> {
  const { installationId, orgSlug, deliveryId } = bound;
  try {
    const gone = fullName.toLowerCase();
    // The owner we bound must own this fullName; do not unwatch a mismatched name.
    if (!gone.startsWith(`${orgSlug}/`)) return;
    const watched = await listWatchedRepos(orgSlug);
    const remaining = watched.filter((r) => r.fullName.toLowerCase() !== gone).map((r) => r.fullName);
    if (remaining.length === watched.length) return;
    const dropped = await reconcileWatchedRepos(installationId, remaining);
    if (dropped > 0) console.warn(`[webhook] installation ${installationId}: unwatched deleted ${fullName}`);
  } catch (err) {
    await abandonDelivery(deliveryId, () =>
      console.warn(`[webhook] could not unwatch deleted ${fullName}`, err instanceof Error ? err.message : err),
    );
  }
}

/**
 * MOONSHOT #1 - record WHO touched a control area and WHEN, without asserting what it became. The row
 * copies the control's CURRENT state and value unchanged from the newest observation, so the ledger's
 * transition flag stays false: it asserts nothing, cannot mask the probe's transition, and cannot
 * alert. A control with NO prior observation gets no attribution row - inventing a baseline from a
 * payload is the exact thing this design refuses.
 */
async function recordControlAttribution(bound: BoundDelivery, fullName: string, event: string, payload: WebhookPayload): Promise<void> {
  const attribution = normalizeGovernanceEvent(event, payload);
  // No actor means the delivery adds nothing a probe will not recover on its own.
  if (!attribution || !attribution.actorLogin) return;

  const ref = await resolveRepoJobRef(bound.orgSlug, fullName).catch(() => null);
  const repoId = ref?.repoId ?? null;
  if (!repoId) return;
  const current = await latestObservations(repoId).catch(() => []);
  const byId = new Map(current.map((o) => [o.controlId, o]));

  const samples: ControlSample[] = [];
  for (const controlId of attribution.controlIds) {
    const seen = byId.get(controlId);
    if (!seen) continue;
    samples.push({
      controlId,
      state: seen.state,
      value: seen.value,
      evidence: { ...attribution.evidence, actor: attribution.actorLogin, attribution: true },
      occurredAt: attribution.occurredAt ?? undefined,
    });
  }
  if (samples.length === 0) return;
  await recordObservations(bound.orgSlug, repoId, samples, {
    repoFullName: fullName,
    source: "webhook",
    actorLogin: attribution.actorLogin,
    deliveryId: bound.deliveryId ?? null,
  }).catch(() => null);
}
