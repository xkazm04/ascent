// LOCAL MODE — the headless project-mapping door.
//
// Two primitives already existed and both work: `/api/org/local/repo` puts an owner/repo into an
// org's scan scope, and `/api/org/local/pairing` verifies a filesystem path and persists it. What
// they could not do is be DRIVEN — both are POST-only, so nothing could read the current mapping
// back, and adding a project meant two round trips that could half-succeed (in scope, unpaired) with
// no way to observe which state you were in. An agent asked to keep a fleet green has to be able to
// ask "what is mapped right now?" before it can decide anything.
//
// So this route is the readable, composable form of the same two primitives, over the org that local
// mode declares (src/lib/local/org.ts). It adds no capability the operator did not already have
// through the Pairing tab; it makes the capability addressable without one.
//
//   GET    ?org=<slug>                      → the org and every project with its pairing state
//   POST   { projects: [{ url, path? }] }   → add to scope, and pair when a path is given
//   POST   { url, path? }                   → the single-project shorthand
//   DELETE { fullName, drop?: true }        → unpair, or leave scope entirely
//
// Guards, outermost first and identical to the routes this composes: self-host (404 on managed
// cloud — the surface does not exist there, and 403 would advertise that it could), the local-org
// flag, DB, then OWNER. Owner and not admin, for the reason the pairing route already gives: a
// mapping points scans at arbitrary server-filesystem paths and is the prerequisite for an agent
// being spawned inside them.
//
// PARTIAL SUCCESS IS REPORTED, NEVER SWALLOWED. A batch reports per project: scope always lands
// first, and a path that fails verification leaves that project IN SCOPE and UNPAIRED with the
// verifier's own sentence attached. That beats both alternatives — rolling back the scope write
// would discard a good half over a fixable typo, and reporting a bare `ok: false` would hide which
// half survived.

import { NextResponse } from "next/server";
import { requireOrgRole } from "@/lib/authz";
import { dbGuard } from "@/lib/api/orgPlan";
import { selfHostGuard } from "@/lib/api/self-host";
import { parseRepoUrl } from "@/lib/github/source";
import { verifyLocalPath } from "@/lib/local/pairing";
import { ensureLocalOrg, localOrgName } from "@/lib/local/org";
import { GREEN_LEVEL, GREEN_MIN_SCORE, fleetGreenness, repoGreenness } from "@/lib/maturity/green";
import { getOrgRollup, listLocalPairings, setRepoLocalPath, setRepoWatch } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** At most this many projects per POST. A mapping call is an operator action, not an import. */
const MAX_PROJECTS_PER_CALL = 25;

const off = () =>
  NextResponse.json(
    {
      error:
        "Local mode has no declared organization. Set ASCENT_LOCAL_ORG (a slug, or 1 for the default) " +
        "on a self-hosted deployment to declare one.",
    },
    { status: 404 },
  );

/** Resolve the declared org and the owner gate in one place, so GET/POST/DELETE cannot drift. */
async function gate(requestedOrg?: unknown) {
  const guard = selfHostGuard() ?? dbGuard("Local projects", "Local project mapping requires a database.");
  if (guard) return { denied: guard as NextResponse };

  const org = await ensureLocalOrg();
  if (!org) return { denied: off() };

  // An explicit `org` is accepted only when it IS the declared one. This door is deliberately not a
  // general-purpose org editor: pointing it at a real tenant would let a local flag write into a
  // fleet it was never meant to reach.
  if (typeof requestedOrg === "string" && requestedOrg.trim() && requestedOrg.trim().toLowerCase() !== org.slug) {
    return {
      denied: NextResponse.json(
        { error: `This door only manages the declared local org ("${org.slug}").` },
        { status: 403 },
      ),
    };
  }

  const roleDenied = await requireOrgRole(org.slug, "owner");
  if (roleDenied) return { denied: roleDenied };
  return { org };
}

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("org");
  const g = await gate(requested);
  if (g.denied) return g.denied;

  const projects = await listLocalPairings(g.org.slug);

  // Greenness rides along on the SAME read, because "what is mapped" and "where does it stand" are
  // one question for anything driving a loop — asking them separately invites acting on a scope that
  // has moved since the standing was measured. `dims` for every repo is already in the rollup, so
  // this costs one query, not nine per repo (which is what /api/org/repo-dimension would have been).
  const rollup = await getOrgRollup(g.org.slug);
  const dimsByRepo = new Map<string, { dimId: string; score: number; signalScore?: number; llmScore?: number }[]>();
  // Dimensions the repo's latest reading could not measure at all (D2/D3/D4 on a local scan with no
  // GitHub-side fold to carry). They are excluded from the verdict and NAMED on the repo's row —
  // an agent driving this door has to be able to tell "cleared nine" from "cleared the six we could
  // see", and it reads `repos[].unmeasurable` for exactly that.
  const unmeasurableByRepo = new Map<string, string[]>();
  for (const r of rollup?.repos ?? []) {
    if (!r.latest) continue;
    dimsByRepo.set(r.fullName, r.latest.dims);
    if (r.latest.unmeasurableDims?.length) unmeasurableByRepo.set(r.fullName, r.latest.unmeasurableDims);
  }

  // Scope is what is WATCHED. An unwatched row still appears in `projects` (it keeps its history and
  // its pairing state is worth seeing) but must not hold the fleet back from green.
  const inScope = projects.filter((p) => p.watched);
  const fleet = fleetGreenness(
    inScope.map((p) => repoGreenness(p.fullName, dimsByRepo.get(p.fullName) ?? [], unmeasurableByRepo.get(p.fullName) ?? [])),
  );

  return NextResponse.json({
    org: g.org.slug,
    name: localOrgName(),
    projects,
    paired: projects.filter((p) => p.localPath != null).length,
    green: {
      target: GREEN_LEVEL,
      minScore: GREEN_MIN_SCORE,
      fleetGreen: fleet.green,
      greenCount: fleet.greenCount,
      inScope: inScope.length,
      totalDebt: fleet.totalDebt,
      repos: fleet.repos,
    },
  });
}

type ProjectInput = { url?: unknown; path?: unknown };

export type ProjectResult = {
  input: string;
  fullName: string | null;
  watched: boolean;
  paired: boolean;
  /** The first actionable problem, or null. A project can be `watched` and still carry one. */
  error: string | null;
  /** Soft signal from the verifier — a mismatched origin warns, it never blocks. */
  originMatch?: "match" | "mismatch" | "unknown";
};

async function addOne(orgSlug: string, entry: ProjectInput): Promise<ProjectResult> {
  const url = typeof entry.url === "string" ? entry.url.trim() : "";
  const path = typeof entry.path === "string" ? entry.path.trim() : null;
  const base: ProjectResult = { input: url, fullName: null, watched: false, paired: false, error: null };
  if (!url) return { ...base, error: "Missing 'url'." };

  const parsed = parseRepoUrl(url);
  if (!parsed) return { ...base, error: "Could not read an owner/repo from that input." };
  const fullName = `${parsed.owner}/${parsed.repo}`;

  // Scope first, and unconditionally: it is the half that never fails for filesystem reasons, and a
  // project in scope but unpaired is a legible, fixable state.
  await setRepoWatch(orgSlug, { owner: parsed.owner, name: parsed.repo, fullName }, true);
  if (!path) return { ...base, fullName, watched: true };

  const check = await verifyLocalPath(path, fullName);
  if (!check.ok) {
    return { ...base, fullName, watched: true, error: check.error, originMatch: check.originMatch };
  }
  const stored = await setRepoLocalPath(orgSlug, fullName, path);
  return {
    ...base,
    fullName,
    watched: true,
    paired: stored,
    error: stored ? null : "Path verified but the repository row could not be updated.",
    originMatch: check.originMatch,
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    org?: unknown;
    projects?: unknown;
    url?: unknown;
    path?: unknown;
  };
  const g = await gate(body.org);
  if (g.denied) return g.denied;

  const list: ProjectInput[] = Array.isArray(body.projects)
    ? (body.projects as ProjectInput[])
    : body.url !== undefined
      ? [{ url: body.url, path: body.path }]
      : [];
  if (list.length === 0) {
    return NextResponse.json({ error: "Provide 'url' or a non-empty 'projects' array." }, { status: 400 });
  }
  if (list.length > MAX_PROJECTS_PER_CALL) {
    return NextResponse.json(
      { error: `At most ${MAX_PROJECTS_PER_CALL} projects per call (${list.length} given).` },
      { status: 422 },
    );
  }

  // Sequential on purpose: each entry spawns git in a working copy, and a parallel fan-out over the
  // operator's own machine buys nothing at this size while making the failure order unreadable.
  const results: ProjectResult[] = [];
  for (const entry of list) results.push(await addOne(g.org.slug, entry));

  // 207 when any entry carries a problem — a batch that half-landed must not read as a clean 200.
  const degraded = results.some((r) => r.error != null);
  return NextResponse.json(
    { org: g.org.slug, results, added: results.filter((r) => r.watched).length, paired: results.filter((r) => r.paired).length },
    { status: degraded ? 207 : 200 },
  );
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { org?: unknown; fullName?: unknown; drop?: unknown };
  const g = await gate(body.org);
  if (g.denied) return g.denied;

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  if (!fullName) return NextResponse.json({ error: "Missing 'fullName'." }, { status: 400 });

  const cleared = await setRepoLocalPath(g.org.slug, fullName, null);
  if (!cleared) {
    return NextResponse.json({ error: "Unknown repository for this organization." }, { status: 404 });
  }
  // `drop` also removes it from scan scope. Unwatching is deliberately NOT a delete: the repo's scan
  // history is the org's record of what it learned, and a mapping call must not be able to erase it.
  if (body.drop === true) {
    const [owner, name] = fullName.split("/");
    if (owner && name) await setRepoWatch(g.org.slug, { owner, name, fullName }, false);
  }
  return NextResponse.json({ ok: true, fullName, paired: false, watched: body.drop !== true });
}
