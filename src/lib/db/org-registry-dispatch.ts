// `RegistryDispatch` — the ledger of hand-offs the Knowledge base tab makes for a fleet repo:
// a populate / map / conform brief given to an operator (`mode: brief`) or run by the local agent
// (`mode: local`) — spark knowledge-base-rebuild.
//
// ASCENT WRITES ONLY THIS LEDGER. The repo, its map and the registry change through the branch and
// PR a dispatch produces, and a dispatch reaches `done` only when a later sweep OBSERVES the map
// move (`mapShaBefore` ≠ `mapShaAfter`) — never because the run said so. That is why the closing
// write is `markDispatch`, driven by whoever watched the sweep, and not a flag the runner sets.
//
// One OPEN dispatch per (repo, stage): `supersedeOpenDispatches` is called by the creator so a new
// brief for the same work marks the older `handed_off` / `running` / `proposed` rows `superseded`
// instead of leaving three briefs that all claim the same PR.
//
// Not barrel-exported, following the standing `org-registry*` convention. Every returned row is the
// contract's wire-safe `RegistryDispatchRow` (ISO strings) from `@/lib/org/knowledge-shape`.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import type {
  RegistryDispatchMode,
  RegistryDispatchRow,
  RegistryDispatchStage,
  RegistryDispatchStatus,
} from "@/lib/org/knowledge-shape";

export const DISPATCH_STAGES: readonly RegistryDispatchStage[] = ["populate", "map", "conform"];
export const DISPATCH_MODES: readonly RegistryDispatchMode[] = ["brief", "local"];
export const DISPATCH_STATUSES: readonly RegistryDispatchStatus[] = ["handed_off", "running", "proposed", "done", "failed", "superseded"];

/** The statuses a newer dispatch for the same (repo, stage) supersedes. Terminal ones are history. */
export const OPEN_DISPATCH_STATUSES: readonly RegistryDispatchStatus[] = ["handed_off", "running", "proposed"];

export interface CreateDispatchInput {
  /** An id minted by the caller, so the brief can carry it VERBATIM before the row exists (the
   *  digest is of the final text). Omitted → the database mints one. */
  id?: string;
  orgId: string;
  repositoryId: string;
  registryId: string;
  stage: RegistryDispatchStage;
  mode: RegistryDispatchMode;
  /** Defaults to `handed_off` (a brief) — a local runner passes `running` once it has spawned. */
  status?: RegistryDispatchStatus;
  /** Subject slugs the brief names; [] for populate / map. */
  subjects?: string[];
  briefDigest: string;
  actor: string;
  mapShaBefore?: string | null;
  branch?: string | null;
  model?: string | null;
  startedAt?: Date | null;
}

export interface MarkDispatchPatch {
  status: RegistryDispatchStatus;
  branch?: string | null;
  prUrl?: string | null;
  mapShaAfter?: string | null;
  model?: string | null;
  costMicros?: number | null;
  turns?: number | null;
  agentDurationMs?: number | null;
  summary?: string | null;
  error?: string | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
}

const one = <T>(v: readonly T[], raw: unknown, fallback: T): T =>
  (v as readonly unknown[]).includes(raw) ? (raw as T) : fallback;

const parseList = (raw: string | null | undefined): string[] => {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

/** Prisma row → the wire-safe contract row. `repoFullName` is joined by the callers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(r: any, repoFullName: string): RegistryDispatchRow {
  return {
    id: r.id,
    repositoryId: r.repositoryId,
    repoFullName,
    stage: one(DISPATCH_STAGES, r.stage, "conform"),
    mode: one(DISPATCH_MODES, r.mode, "brief"),
    status: one(DISPATCH_STATUSES, r.status, "handed_off"),
    subjects: parseList(r.subjectsJson),
    briefDigest: r.briefDigest,
    actor: r.actor,
    branch: r.branch ?? null,
    prUrl: r.prUrl ?? null,
    mapShaBefore: r.mapShaBefore ?? null,
    mapShaAfter: r.mapShaAfter ?? null,
    model: r.model ?? null,
    costMicros: r.costMicros ?? null,
    turns: r.turns ?? null,
    agentDurationMs: r.agentDurationMs ?? null,
    summary: r.summary ?? null,
    error: r.error ?? null,
    createdAt: new Date(r.createdAt ?? Date.now()).toISOString(),
    startedAt: iso(r.startedAt),
    endedAt: iso(r.endedAt),
  };
}

async function repoName(repositoryId: string): Promise<string> {
  const repo = await getPrisma().repository.findUnique({ where: { id: repositoryId }, select: { fullName: true } });
  return repo?.fullName ?? repositoryId;
}

/**
 * Open a dispatch. Returns null when persistence is off — a brief can still be composed and shown,
 * it just leaves no ledger row, and the caller says so rather than pretending it was recorded.
 */
export async function createDispatch(input: CreateDispatchInput): Promise<RegistryDispatchRow | null> {
  if (!isDbConfigured()) return null;
  const row = await getPrisma().registryDispatch.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      orgId: input.orgId,
      repositoryId: input.repositoryId,
      registryId: input.registryId,
      stage: input.stage,
      mode: input.mode,
      status: input.status ?? "handed_off",
      subjectsJson: JSON.stringify((input.subjects ?? []).slice(0, 200)),
      briefDigest: input.briefDigest.slice(0, 200),
      actor: input.actor.slice(0, 200),
      mapShaBefore: input.mapShaBefore ?? null,
      branch: input.branch ?? null,
      model: input.model ?? null,
      startedAt: input.startedAt ?? null,
    },
  });
  return toRow(row, await repoName(row.repositoryId));
}

/** Newest first, joined to the repo's full name. `limit` defaults to 50 and is capped at 500. */
export async function listDispatches(
  orgId: string,
  opts: { repositoryId?: string; limit?: number } = {},
): Promise<RegistryDispatchRow[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const rows = await prisma.registryDispatch.findMany({
    where: { orgId, ...(opts.repositoryId ? { repositoryId: opts.repositoryId } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(500, Math.max(1, opts.limit ?? 50)),
  });
  const ids = Array.from(new Set(rows.map((r) => r.repositoryId)));
  const repos = ids.length
    ? await prisma.repository.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
    : [];
  const names = new Map(repos.map((r) => [r.id, r.fullName]));
  return rows.map((r) => toRow(r, names.get(r.repositoryId) ?? r.repositoryId));
}

/**
 * Move a dispatch along. `orgId` travels into the query beside the id (gate-then-constrain), so a
 * dispatch belonging to another org is not found rather than updated. Returns the updated row, or
 * null when nothing matched (or persistence is off).
 */
export async function markDispatch(orgId: string, id: string, patch: MarkDispatchPatch): Promise<RegistryDispatchRow | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const data = {
    status: patch.status,
    ...(patch.branch !== undefined ? { branch: patch.branch } : {}),
    ...(patch.prUrl !== undefined ? { prUrl: patch.prUrl } : {}),
    ...(patch.mapShaAfter !== undefined ? { mapShaAfter: patch.mapShaAfter } : {}),
    ...(patch.model !== undefined ? { model: patch.model } : {}),
    ...(patch.costMicros !== undefined ? { costMicros: patch.costMicros } : {}),
    ...(patch.turns !== undefined ? { turns: patch.turns } : {}),
    ...(patch.agentDurationMs !== undefined ? { agentDurationMs: patch.agentDurationMs } : {}),
    ...(patch.summary !== undefined ? { summary: patch.summary ? patch.summary.slice(0, 4000) : patch.summary } : {}),
    ...(patch.error !== undefined ? { error: patch.error ? patch.error.slice(0, 2000) : patch.error } : {}),
    ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
    ...(patch.endedAt !== undefined ? { endedAt: patch.endedAt } : {}),
  };
  const { count } = await prisma.registryDispatch.updateMany({ where: { id, orgId }, data });
  if (!count) return null;
  const row = await prisma.registryDispatch.findUnique({ where: { id } });
  return row ? toRow(row, await repoName(row.repositoryId)) : null;
}

/**
 * Mark every OPEN dispatch for (repo, stage) `superseded`, except `exceptId` (the one that replaces
 * them). Returns how many were closed. Terminal rows (`done`, `failed`, `superseded`) are history
 * and are left alone.
 */
export async function supersedeOpenDispatches(
  orgId: string,
  repositoryId: string,
  stage: RegistryDispatchStage,
  exceptId?: string,
): Promise<number> {
  if (!isDbConfigured()) return 0;
  const { count } = await getPrisma().registryDispatch.updateMany({
    where: {
      orgId,
      repositoryId,
      stage,
      status: { in: [...OPEN_DISPATCH_STATUSES] },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    data: { status: "superseded", endedAt: new Date() },
  });
  return count;
}
