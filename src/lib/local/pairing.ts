// LOCAL MODE pairing verification: is this server-filesystem path really a working copy of that
// repository? Called by the Admin → Pairing routes before a path is persisted, and re-called at
// use time (rescan/autopilot) so a folder that moved since pairing fails with a reason, not an
// ENOENT stack.
//
// The checks are ordered cheapest-first and each failure names the FIRST problem only — an operator
// fixing a pairing wants one actionable sentence, not a checklist of everything wrong at once.
// `originMatch` is a soft signal by design: a local-only repo (no remote yet) or a differently-named
// mirror is still scannable, so a mismatched origin WARNS but never blocks — the operator confirmed
// the path themselves, and the ingestion reads only what is on disk either way.

import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { ownerRepoFromRemoteUrl, runGit } from "@/lib/local/git";

export interface PairingCheck {
  ok: boolean;
  /** First hard failure, actionable ("Folder does not exist", "Not a git repository"). Null when ok. */
  error: string | null;
  /** Soft signal: origin's owner/repo vs the paired fullName. "unknown" = no remote / unparsable. */
  originMatch: "match" | "mismatch" | "unknown";
  /** The origin URL's owner/repo, when one was readable — shown beside a mismatch so the operator
   *  sees WHAT the folder actually points at. */
  origin: string | null;
  /** HEAD commit sha — proof the repo has at least one commit, and the identity a scan would pin to. */
  headSha: string | null;
  /** The branch HEAD is on (null when detached) — display context for the pairing row. */
  branch: string | null;
}

const fail = (error: string, origin: string | null = null): PairingCheck => ({
  ok: false,
  error,
  originMatch: "unknown",
  origin,
  headSha: null,
  branch: null,
});

/** Verify `path` as a working copy of `fullName` ("owner/repo"). Never throws. */
export async function verifyLocalPath(path: string, fullName: string): Promise<PairingCheck> {
  const p = path.trim();
  if (!p) return fail("Path is empty.");
  // Relative paths would resolve against the SERVER PROCESS's cwd — a location the operator can't
  // see and that changes between launch methods (npm run dev vs the container). Refuse rather than
  // guess; the error names the fix.
  if (!isAbsolute(p)) return fail("Path must be absolute (it resolves on the server's filesystem).");

  const st = await stat(p).catch(() => null);
  if (!st) return fail("Folder does not exist on the server's filesystem.");
  if (!st.isDirectory()) return fail("Path exists but is not a folder.");

  // `rev-parse --is-inside-work-tree` (not `.git` existence): it accepts worktrees and submodule
  // layouts where `.git` is a FILE, and rejects a bare repo — which has no working copy to scan.
  const inTree = await runGit(p, ["rev-parse", "--is-inside-work-tree"]);
  if (!inTree.ok || inTree.stdout.trim() !== "true") {
    return fail("Not a git repository (or git is not installed on the server).");
  }

  const head = await runGit(p, ["rev-parse", "HEAD"]);
  if (!head.ok) return fail("Repository has no commits yet — commit something, then pair it.");
  const headSha = head.stdout.trim();

  const branchRes = await runGit(p, ["branch", "--show-current"]);
  const branch = branchRes.ok && branchRes.stdout.trim() ? branchRes.stdout.trim() : null;

  const originRes = await runGit(p, ["remote", "get-url", "origin"]);
  const origin = originRes.ok ? ownerRepoFromRemoteUrl(originRes.stdout) : null;
  const originMatch: PairingCheck["originMatch"] =
    origin == null ? "unknown" : origin === fullName.trim().toLowerCase() ? "match" : "mismatch";

  return { ok: true, error: null, originMatch, origin, headSha, branch };
}
