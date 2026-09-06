// GET  /api/org/:slug/registry/dispatch                 -> { dispatches: RegistryDispatchRow[] } (newest first;
//                                                          `?repositoryId=` narrows)
// POST /api/org/:slug/registry/dispatch                 -> hand a fleet repo's registry stage to an agent
//   { repositoryId, stage: "populate"|"map"|"conform", subjects?: string[], mode: "brief"|"local" }
//   brief → 201 { dispatch, brief }   the artifact is composed and recorded; the operator runs it
//   local → 202 { dispatch }          the local plane runs it in a worktree of the paired checkout
//
// `[slug]`-scoped, gate-then-constrain: the org is gated, then `repositoryId` travels INTO the org-
// constrained query (`listSweepTargets({ orgId }, [id])`), so a foreign repo is a 404, never a read.
//
// Gates. GET is the member read every registry GET uses. `brief` is the ADMIN floor WITHOUT a token
// (`guardRegistryRole`): composing a brief writes nothing to GitHub, so a deployment with no App can
// still hand one to an operator. `local` is the full local-mode stack in the order the autopilot
// route states it — self-host 404, owner, consent (409 `autopilot-off`), pairing (409 `not-paired`)
// — and then mints an installation token (`guardRegistryWrite`, owner floor) because the run ends
// in a push, a PR and a sweep, all of which need one.
//
// Ascent writes ONLY its own ledger here. The repo, its map and the registry change through the
// branch and PR the dispatch produces, and the row reaches `done` only when a later sweep sees the
// map move — never because this route (or the runner) said so.

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveViewerLogin } from "@/lib/access";
import { requireOrgRole } from "@/lib/authz";
import { selfHostGuard } from "@/lib/api/self-host";
import { getRepoLocalPath } from "@/lib/db";
import { getOrgId } from "@/lib/db/org-rollup";
import { getOrgRegistry } from "@/lib/db/org-registry";
import { listConformanceMaps, listSweepTargets } from "@/lib/db/org-registry-conformance";
import {
  DISPATCH_MODES,
  DISPATCH_STAGES,
  createDispatch,
  listDispatches,
  supersedeOpenDispatches,
} from "@/lib/db/org-registry-dispatch";
import { autopilotEnabled } from "@/lib/local/agent";
import type { RegistryDispatchMode, RegistryDispatchStage } from "@/lib/org/knowledge-shape";
import { guardRegistryRead, guardRegistryRole, guardRegistryWrite, registryError } from "@/lib/registry/api";
import { MAX_CONFORM_SUBJECTS, briefDigest, buildRegistryBrief } from "@/lib/registry/dispatch-brief";
import { defaultDispatchDeps, detectDefaultBranch, runLocalDispatch } from "@/lib/registry/dispatch-local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where the registry's own manifest convention puts the local checkout (`registry.local`). */
const REGISTRY_LOCAL_HINT = "../ai-registry";

const pick = <T extends string>(allowed: readonly string[], raw: unknown): T | undefined =>
  typeof raw === "string" && allowed.includes(raw) ? (raw as T) : undefined;

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const denied = await guardRegistryRead(slug);
  if (denied) return denied;
  const orgId = await getOrgId(slug).catch(() => null);
  if (!orgId) return NextResponse.json({ dispatches: [] });
  const repositoryId = new URL(request.url).searchParams.get("repositoryId")?.trim() || undefined;
  return NextResponse.json({ dispatches: await listDispatches(orgId, { limit: 100, ...(repositoryId ? { repositoryId } : {}) }) });
}

/** The org-constrained target: the repo row, its last-swept header (if any) and the registry. */
async function resolveTarget(slug: string, repositoryId: string, stage: RegistryDispatchStage) {
  const orgId = await getOrgId(slug).catch(() => null);
  if (!orgId) return { denied: registryError("not-found", "Unknown organization.", 404) };
  const registry = await getOrgRegistry(slug);
  if (!registry) return { denied: registryError("not-mapped", "Map an AI registry for this organization first.", 409) };
  const targets = await listSweepTargets({ orgId }, [repositoryId]);
  const repo = targets?.repos.find((r) => r.id === repositoryId);
  if (!repo) return { denied: registryError("not-found", "Unknown repository for this organization.", 404) };
  const map = (await listConformanceMaps(orgId).catch(() => [])).find((m) => m.repositoryId === repositoryId) ?? null;
  if (stage === "conform" && !map?.mapSha) {
    return { denied: registryError("invalid-input", `${repo.fullName} has no .ai/registry-map.json yet — dispatch the map stage first.`, 409) };
  }
  return { orgId, registry, repo, mapSha: map?.mapSha ?? null, domains: map?.domains ?? [] };
}

const localRefusal = (error: "autopilot-off" | "not-paired", message: string) =>
  NextResponse.json({ error, code: "no-op", message }, { status: 409 });

export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const stage = pick<RegistryDispatchStage>(DISPATCH_STAGES, body.stage);
  const mode = pick<RegistryDispatchMode>(DISPATCH_MODES, body.mode);
  const repositoryId = typeof body.repositoryId === "string" ? body.repositoryId.trim() : "";
  if (!stage) return registryError("invalid-input", `stage must be one of ${DISPATCH_STAGES.join(", ")}.`, 400);
  if (!mode) return registryError("invalid-input", `mode must be one of ${DISPATCH_MODES.join(", ")}.`, 400);
  if (!repositoryId) return registryError("invalid-input", "Missing 'repositoryId'.", 400);
  const subjects =
    stage === "conform" && Array.isArray(body.subjects)
      ? Array.from(new Set(body.subjects.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean)))
      : [];
  if (stage === "conform" && subjects.length === 0) return registryError("invalid-input", "A conform dispatch names at least one subject.", 400);
  if (subjects.length > MAX_CONFORM_SUBJECTS) {
    return registryError("invalid-input", `At most ${MAX_CONFORM_SUBJECTS} subjects per conform dispatch.`, 400);
  }

  // ── gates, in the order the sibling routes state them ───────────────────────────────────────
  if (mode === "brief") {
    const denied = await guardRegistryRole(slug, "admin");
    if (denied) return denied;
  } else {
    const guard = selfHostGuard();
    if (guard) return guard;
    const denied = await requireOrgRole(slug, "owner");
    if (denied) return denied;
    if (!autopilotEnabled()) {
      return localRefusal("autopilot-off", "Autopilot is not enabled on this deployment — set ASCENT_AUTOPILOT=1 with the claude CLI on PATH.");
    }
  }

  const target = await resolveTarget(slug, repositoryId, stage);
  if ("denied" in target) return target.denied;
  const { orgId, registry, repo, mapSha, domains } = target;

  // A paired checkout is REQUIRED for a local run and merely consulted for a brief (it is the one
  // place the repo's default branch can be read without a GitHub token).
  const localPath = await getRepoLocalPath(slug, repo.fullName).catch(() => null);
  let token: string | null = null;
  if (mode === "local") {
    if (!localPath) return localRefusal("not-paired", `${repo.fullName} is not paired with a local path — pair it on Admin → Pairing.`);
    const gate = await guardRegistryWrite(slug, { minRole: "owner" });
    if (gate instanceof NextResponse) return gate;
    token = gate.token;
  }

  // ── the artifact, then the row ───────────────────────────────────────────────────────────────
  // The id is minted HERE so the brief carries it verbatim and the digest is of the final text.
  const dispatchId = randomUUID();
  const defaultBranch = await detectDefaultBranch(localPath);
  const brief = buildRegistryBrief({
    dispatchId,
    repoFullName: repo.fullName,
    defaultBranch,
    stage,
    subjects,
    registry: { fullName: registry.fullName, localHint: REGISTRY_LOCAL_HINT },
    domains,
  });
  const actor = (await resolveViewerLogin().catch(() => null)) ?? "unknown";
  await supersedeOpenDispatches(orgId, repositoryId, stage);
  const dispatch = await createDispatch({
    id: dispatchId,
    orgId,
    repositoryId,
    registryId: registry.id,
    stage,
    mode,
    status: mode === "local" ? "running" : "handed_off",
    subjects,
    briefDigest: briefDigest(brief),
    actor,
    mapShaBefore: mapSha,
    ...(mode === "local" ? { startedAt: new Date() } : {}),
  });
  if (!dispatch) return registryError("persistence-off", "The dispatch could not be recorded.", 503);

  if (mode === "brief") return NextResponse.json({ dispatch, brief }, { status: 201 });

  // Detached, exactly as the drive and loop routes start their work: the row is the progress
  // report, and the runner writes every outcome on it (`runLocalDispatch` never throws).
  void runLocalDispatch(defaultDispatchDeps(), {
    orgId,
    dispatchId: dispatch.id,
    stage,
    repo: { repositoryId, fullName: repo.fullName, defaultBranch, localPath: localPath! },
    brief,
    token: token!,
  }).catch(() => null);
  return NextResponse.json({ dispatch }, { status: 202 });
}
