// POST /api/me/watch — add/remove a PUBLIC repo on the signed-in viewer's PERSONAL watchlist.
//   { repo: "owner/name" | GitHub URL, watched: boolean }
//
// The personal workspace is a LENS over the shared public corpus: this route only writes a pointer
// Repository row (watched=true) under the viewer's personal org (slug = their GitHub login) — the
// repo's scan series stays in the shared "public" org. Unlike /api/org/watch it does NOT require the
// GitHub App (individuals track public repos, no installation involved); instead the repo's existence
// AND public visibility are verified against the GitHub API before a watch is accepted, so a private
// or nonexistent repo can never become a watchlist pointer. Capped at PERSONAL_WATCH_LIMIT (the
// free-with-limits individual tier — a 402 is the upgrade moment, mirroring the scan-credit gate).

import { NextResponse } from "next/server";
import { getViewer } from "@/lib/access";
import { countPersonalWatched, isDbConfigured, setRepoWatch, PERSONAL_WATCH_LIMIT } from "@/lib/db";
import { ensureOwnerMembership } from "@/lib/db/members";
import { parseRepoUrl } from "@/lib/github/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One cheap unauthenticated (or ambient-token) metadata call: does the repo exist AND is it public?
 *  GitHub answers 404 for both "missing" and "private without access", which is exactly the refusal
 *  we want; the explicit `private` check guards the ambient-PAT case where a private repo IS visible. */
async function verifyPublicRepo(owner: string, name: string): Promise<"ok" | "not_public" | "upstream"> {
  const token = process.env.GITHUB_TOKEN;
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: {
        accept: "application/vnd.github+json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return "not_public";
    if (!res.ok) return "upstream";
    const meta = (await res.json()) as { private?: boolean };
    return meta.private === false ? "ok" : "not_public";
  } catch {
    return "upstream";
  }
}

export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "The personal watchlist requires a database." }, { status: 503 });
  }
  // Identity, not org membership, is the gate: the target org IS the viewer's own login-namespace,
  // so a signed-in viewer can never write anyone else's watchlist.
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.json({ error: "Sign in to track repositories." }, { status: 401 });
  }
  const slug = viewer.login.trim().toLowerCase();

  const body = (await request.json().catch(() => ({}))) as { repo?: string; watched?: boolean };
  const parsed = body.repo ? parseRepoUrl(body.repo) : null;
  if (!parsed) {
    return NextResponse.json({ error: "Provide a repository as owner/name or a GitHub URL." }, { status: 400 });
  }
  const fullName = `${parsed.owner}/${parsed.repo}`;
  const watched = Boolean(body.watched);

  if (watched) {
    const count = await countPersonalWatched(slug);
    if (count >= PERSONAL_WATCH_LIMIT) {
      return NextResponse.json(
        { error: `Personal watchlists are capped at ${PERSONAL_WATCH_LIMIT} repositories. Remove one to add another.` },
        { status: 402 },
      );
    }
    const check = await verifyPublicRepo(parsed.owner, parsed.repo);
    if (check === "not_public") {
      return NextResponse.json(
        { error: `${fullName} doesn't exist or isn't public. Personal workspaces track public repositories.` },
        { status: 404 },
      );
    }
    if (check === "upstream") {
      return NextResponse.json({ error: "Couldn't reach GitHub to verify the repository. Try again." }, { status: 502 });
    }
  }

  try {
    // Idempotently materialize + flavor the personal org before the pointer write, so the very first
    // watch works even when the viewer has never visited /org/{login} (which otherwise does this seed).
    await ensureOwnerMembership(slug, viewer.login, viewer.name, { kind: "personal" });
    await setRepoWatch(
      slug,
      { owner: parsed.owner, name: parsed.repo, fullName, url: `https://github.com/${fullName}`, isPrivate: false },
      watched,
    );
    return NextResponse.json({ ok: true, fullName, watched });
  } catch (err) {
    console.error("[me/watch] failed", err);
    return NextResponse.json({ error: "Failed to update your watchlist." }, { status: 500 });
  }
}
