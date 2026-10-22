// The GitHub App webhook's event table (challenge-2026-10-22d github-app-0). One row per subscribed
// event: its preconditions, its bind, its declared effects, and `schedule`, which reads the payload
// and defers the work through `ctx.defer` (the route passes Next's `after`). The route keeps bounds,
// verify, parse and claim, then calls `dispatchWebhook`.
//
// The bind is declared, and guarded by arms.test.ts as DATA (no source scanning): an arm whose effects
// include a tenant write must bind `owner` (a BoundDelivery from ./owner-bind) or `github-confirmed`
// (every write keyed by the installation id after a GitHub App-JWT read). The same test holds the
// table's events equal to the event table in docs/features/github/github-app.md.

import { isAppConfigured } from "@/lib/github/app";
import { isDbConfigured, isRepoAutoscanned } from "@/lib/db";
import { runPrGate, type PrGateRef } from "@/lib/github/pr-gate";
import { abandonDelivery } from "@/lib/github/webhook-delivery";
// The push rescan is a REAL, LLM-billed scan: the route enqueues a rescore job and drains it, and the
// queue worker's push branch owns the reserve/skip/refund (scan-queue-worker.ts).
import { enqueueAndDrainPushRescan } from "@/lib/push-rescan";
import { onRegistryPush } from "@/lib/registry/registry-push";
import { bindDelivery, installationMatchesOwner } from "./owner-bind";
import { reconcileInstallationRepos, runInstallationLifecycle } from "./lifecycle-arm";
import { runOrgControlArm, runRepoControlArm } from "./control-arms";
import { runAiChangeArm } from "./ai-change-arm";
import type { WebhookPayload } from "./payload";

export type ArmBind = "owner" | "github-confirmed" | "none";
export type ArmEffect = "tenant-write" | "github-write";

export interface ArmContext {
  payload: WebhookPayload;
  deliveryId?: string;
  /** The push rescan's drain deadline is measured from the request's arrival. */
  invokedAt: number;
  maxDurationSec: number;
  defer: (task: () => unknown) => void;
}

export interface WebhookArm {
  event: string;
  needs: { app: boolean; db: boolean };
  bind: ArmBind;
  effects: readonly ArmEffect[];
  schedule: (ctx: ArmContext) => void;
}

const PR_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

/** Bind, then gate. The PR gate mints a token, so it binds with the live GitHub confirm. */
function deferPrGate(ctx: ArmContext, ref: PrGateRef): void {
  ctx.defer(async () => {
    if (!(await bindDelivery(ref.installationId, ref.owner, ctx.deliveryId))) return;
    await runPrGate(ref, { onRetryable: () => abandonDelivery(ctx.deliveryId) });
  });
}

/**
 * Queue a push rescan of an autoscanned repo and drain it. Not autoscanned is a deterministic no-op
 * checked BEFORE the bind (the bind can round-trip to GitHub); a refused bind or no job row releases
 * the delivery; once a row exists it is the durable record and the delivery is kept.
 */
async function runPushRescan(ctx: ArmContext, installationId: number, owner: string, repo: string): Promise<void> {
  const deliveryId = ctx.deliveryId;
  try {
    const fullName = `${owner}/${repo}`;
    if (!(await isRepoAutoscanned(owner.toLowerCase(), fullName))) return;
    const bound = await bindDelivery(installationId, owner, deliveryId);
    if (!bound) return;
    const res = await enqueueAndDrainPushRescan({
      orgSlug: bound.orgSlug,
      fullName,
      deliveryId,
      invokedAt: ctx.invokedAt,
      maxDurationSec: ctx.maxDurationSec,
    });
    if (!res.enqueued) await abandonDelivery(deliveryId);
  } catch (err) {
    await abandonDelivery(deliveryId, () => console.error("[webhook] push rescan failed", err instanceof Error ? err.message : err));
  }
}

const repoControlArm = (event: string): WebhookArm => ({
  event,
  needs: { app: true, db: true },
  bind: "owner",
  effects: ["tenant-write"],
  schedule: ({ payload, deliveryId, defer }) => {
    const installationId = payload.installation?.id;
    const owner = payload.repository?.owner?.login;
    const fullName = payload.repository?.full_name;
    if (installationId && owner && fullName) defer(() => runRepoControlArm(installationId, owner, fullName, event, payload, deliveryId));
  },
});

const orgControlArm = (event: string): WebhookArm => ({
  event,
  needs: { app: true, db: true },
  bind: "owner",
  effects: ["tenant-write"],
  schedule: ({ payload, deliveryId, defer }) => {
    const installationId = payload.installation?.id;
    const owner = payload.organization?.login ?? payload.repository?.owner?.login;
    const repoFullName = payload.repository?.full_name;
    if (installationId && owner) defer(() => runOrgControlArm(installationId, owner, event, repoFullName, deliveryId));
  },
});

export const WEBHOOK_ARMS: readonly WebhookArm[] = [
  {
    event: "installation",
    needs: { app: false, db: false },
    bind: "github-confirmed",
    effects: ["tenant-write"],
    schedule: ({ payload, deliveryId, defer }) => {
      const id = payload.installation?.id;
      const action = payload.action;
      if (id != null && (action === "created" || action === "unsuspend" || action === "deleted" || action === "suspend")) {
        defer(() => runInstallationLifecycle(id, action, deliveryId));
      }
    },
  },
  {
    event: "installation_repositories",
    needs: { app: true, db: true },
    bind: "github-confirmed",
    effects: ["tenant-write"],
    schedule: ({ payload, deliveryId, defer }) => {
      const id = payload.installation?.id;
      if (id != null) defer(() => reconcileInstallationRepos(id, deliveryId));
    },
  },
  {
    event: "pull_request",
    needs: { app: true, db: false },
    bind: "owner",
    effects: ["github-write", "tenant-write"],
    schedule: (ctx) => {
      const { payload } = ctx;
      const installationId = payload.installation?.id;
      const owner = payload.repository?.owner?.login;
      const repo = payload.repository?.name;
      const prNumber = payload.pull_request?.number;
      const headSha = payload.pull_request?.head?.sha;
      const baseRef = payload.pull_request?.base?.ref ?? payload.repository?.default_branch;
      if (installationId && owner && repo && prNumber && headSha && baseRef && PR_ACTIONS.has(payload.action ?? "")) {
        deferPrGate(ctx, { installationId, owner, repo, prNumber, headSha, baseRef });
      }
      // A MERGED close is the AI-change evidence moment; not a gate action, so it sits beside it.
      if (owner && payload.action === "closed" && isDbConfigured()) {
        ctx.defer(() => runAiChangeArm("pull_request", payload, ctx.deliveryId));
      }
    },
  },
  {
    event: "pull_request_review",
    // Not gated on the App: it mints no token and its bind reads the stored mapping only.
    needs: { app: false, db: true },
    bind: "owner",
    effects: ["tenant-write"],
    schedule: ({ payload, deliveryId, defer }) => {
      if (payload.repository?.owner?.login) defer(() => runAiChangeArm("pull_request_review", payload, deliveryId));
    },
  },
  {
    event: "check_run",
    needs: { app: true, db: false },
    bind: "owner",
    effects: ["github-write", "tenant-write"],
    schedule: (ctx) => {
      const { payload } = ctx;
      const isRerun =
        payload.action === "rerequested" ||
        (payload.action === "requested_action" && payload.requested_action?.identifier === "rescan");
      const installationId = payload.installation?.id;
      const owner = payload.repository?.owner?.login;
      const repo = payload.repository?.name;
      const pr = payload.check_run?.pull_requests?.[0];
      const headSha = payload.check_run?.head_sha;
      const prNumber = pr?.number;
      const baseRef = pr?.base?.ref ?? payload.repository?.default_branch;
      if (isRerun && installationId && owner && repo && prNumber && headSha && baseRef) {
        deferPrGate(ctx, { installationId, owner, repo, prNumber, headSha, baseRef });
      }
    },
  },
  {
    event: "push",
    needs: { app: true, db: true },
    bind: "owner",
    effects: ["tenant-write"],
    schedule: (ctx) => {
      const { payload } = ctx;
      const installationId = payload.installation?.id;
      const owner = payload.repository?.owner?.login;
      const repo = payload.repository?.name;
      const defaultBranch = payload.repository?.default_branch;
      const onDefault = defaultBranch != null && payload.ref === `refs/heads/${defaultBranch}`;
      const headMoved = !payload.deleted && !!payload.after && !/^0+$/.test(payload.after);
      if (!(installationId && owner && repo && onDefault && headMoved)) return;
      ctx.defer(() => runPushRescan(ctx, installationId, owner, repo));
      // Deliberately NOT released on failure: the rescan job may already exist, and a missed registry
      // pass is recovered by the next push or the tab's Re-index button. Its bind is `ownerMatches`.
      const slice = { installationId, owner, repo, ref: payload.ref, defaultBranch, after: payload.after, deleted: payload.deleted, commits: payload.commits };
      ctx.defer(() =>
        onRegistryPush(slice, { ownerMatches: installationMatchesOwner }).then(
          () => undefined,
          (err) => console.error("[webhook] registry push lane failed", err instanceof Error ? err.message : err),
        ),
      );
    },
  },
  repoControlArm("branch_protection_rule"),
  repoControlArm("repository_ruleset"),
  repoControlArm("repository"),
  orgControlArm("member"),
  orgControlArm("team"),
];

/** The table guard, as data: a tenant write without a bind, or an event declared twice. */
export function armTableViolations(arms: readonly WebhookArm[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const arm of arms) {
    if (seen.has(arm.event)) out.push(`${arm.event}: declared twice`);
    seen.add(arm.event);
    if (arm.effects.includes("tenant-write") && arm.bind === "none") out.push(`${arm.event}: declares tenant-write with bind 'none'`);
  }
  return out;
}

/** Route one verified, claimed delivery. Unknown event or an unmet precondition is a no-op. */
export function dispatchWebhook(event: string, ctx: ArmContext): void {
  const arm = WEBHOOK_ARMS.find((a) => a.event === event);
  if (!arm) return;
  if (arm.needs.app && !isAppConfigured()) return;
  if (arm.needs.db && !isDbConfigured()) return;
  arm.schedule(ctx);
}
