// The `local` Forge record — the self-hosted working-copy ingestion path, which has been a
// `RepoSource` since local mode shipped and is registered here so `resolveForge` has an answer for
// every value `Repository.forge` can hold (a repo scanned locally persists `forge: "local"`).
//
// The one thing this adapter CANNOT do is manufacture its own source: `LocalFsSource` is constructed
// with the absolute path of a paired working copy, and that pairing lives in the org's local-mode
// record, not in a URL. So `source()` throws with a message that names the seam, and the callers that
// really do local scans keep injecting the source they already build (`opts.source`,
// `org/local/rescan/route.ts`, `loop-lane.ts`) — unchanged by this lane. `localSource(root)` is the
// same construction, exposed so a future caller that HAS a root goes through the forge.

// `LocalFsSource` is imported LAZILY, inside `localSource()`. A static import would put
// `node:fs/promises` and `child_process` in this module's graph — and `registry.ts` imports this
// module, so anything that reaches the registry would inherit them. The Integrations card does
// exactly that (through the capability table), which makes it a CLIENT bundle pulling node builtins:
// `tsc` and the full vitest suite stay green, and `next build` fails. That is the trap the repo's
// "build is not in the gate" note describes, and this dynamic import is the fix pattern for it.
import { GitHubError } from "@/lib/forge/types";
import type { Forge, ForgeCapabilities, ParsedRepo, RepoSource } from "@/lib/forge/types";

/**
 * A working copy on disk observes NOTHING a forge API observes — there are no pull requests, no
 * branch protection, no pipelines to read. Every capability is therefore `false`, and that is an
 * honest "not observable here", never a zero: a local scan's report already reaches these signals
 * through the same token-less nulls a keyless GitHub scan produces. `anonymous: true` because a local
 * scan needs no credential at all.
 */
export const LOCAL_CAPABILITIES: ForgeCapabilities = {
  pullRequests: false,
  branchGovernance: false,
  deployments: false,
  ciHealth: false,
  securityPosture: false,
  securityExposure: false,
  appInventory: false,
  // CODEOWNERS is a FILE, so it is read from the working copy like any other — the capability flag is
  // about the forge's API surface, and local mode has none.
  codeowners: false,
  write: false,
  anonymous: true,
};

/**
 * The local source for an already-resolved working-copy root. Returns a thin `RepoSource` that loads
 * `LocalFsSource` on first use, so the node-only ingestion code is pulled in when a local scan
 * actually runs and never merely because something imported the registry (see the header).
 */
export function localSource(root: string): RepoSource {
  return {
    async fetchSnapshot(repo, opts) {
      const { LocalFsSource } = await import("@/lib/local/source");
      return new LocalFsSource(root).fetchSnapshot(repo, opts);
    },
  };
}

export const localForge: Forge = {
  id: "local",
  label: "Local working copy",
  capabilities: LOCAL_CAPABILITIES,
  // A local scan is addressed by an explicit `local:owner/name` coordinate, never by a bare
  // `owner/name` — which must keep meaning GitHub, as it has always meant. The registry only reaches
  // this parser after the explicit-prefix branch, so nothing that parses today changes.
  parseUrl(input: string): ParsedRepo | null {
    const parts = input.trim().split("/").filter(Boolean);
    if (parts.length !== 2) return null;
    const [owner, repo] = parts as [string, string];
    const ok = /^[A-Za-z0-9_.-]{1,100}$/;
    if (!ok.test(owner) || !ok.test(repo)) return null;
    if (owner.startsWith(".") || repo.startsWith(".") || owner.includes("..") || repo.includes("..")) return null;
    return { owner, repo };
  },
  source(): RepoSource {
    throw new GitHubError(
      "INVALID_URL",
      "Local scans need a paired working copy: build the source with localSource(root) and inject it.",
    );
  },
  // A working copy has no web home. The coordinate is echoed back so a caller building a link gets
  // something identifiable rather than a fabricated github.com URL for code that was never pushed.
  permalink(repo: ParsedRepo): string {
    return `local:${repo.owner}/${repo.repo}`;
  },
};
