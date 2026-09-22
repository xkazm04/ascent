// A default-branch push, as the registry lane sees it. The GitHub webhook route schedules this beside
// its watched-repo rescan (`after()`); by then the delivery is signature-verified and dedup-claimed.
//
// Two cases, and everything else is ignored:
//   1. The push IS one of the org's mapped registries -> witness the webhook (`webhookHealthy`) and run
//      a TRAILING index pass through the single-flight door: the pass already running (if any) may have
//      read the tree before this push landed, so exactly one more pass follows it. The index pass
//      chains the fleet conformance sweep itself, so nothing else is needed here.
//   2. The push is a FLEET repo whose commits touch its `.ai/` map or manifest, in an org that has a
//      registry -> re-sweep that ONE repo. The sweep is what closes a dispatch whose map PR merged; a
//      whole-org sweep for one repo's map move would be N reads for one fact.
//
// A locally paired registry (self-hosted) is read from its checkout, not from GitHub, so a GitHub push
// does not index it — the render refresh does, when the checkout moves. The webhook is still witnessed.
//
// Token minting is gated on the installation actually belonging to the pushing owner, the same
// discipline as the rescan beside it: the route injects its own GitHub-confirming check; the default
// here is the strict stored-mapping match, failing closed.

import { listOrgRegistries, type OrgRegistryRow } from "@/lib/db/org-registry";
import { markRegistryWebhookSeen } from "@/lib/db/org-registry-write";
import { resolveRepoJobRef } from "@/lib/db/scan-jobs";
import { getInstallationIdForOwner } from "@/lib/db/installations";
import { getInstallationToken } from "@/lib/github/app";
import { sweepConformance } from "./conformance-sweep";
import { githubSource } from "./index-walk";
import { runIndexPass } from "./index-pass";
import { localRegistryDir } from "./local-registry";

/** The slice of a `push` delivery this lane reads. */
export interface RegistryPush {
  installationId: number;
  owner: string;
  repo: string;
  ref?: string;
  defaultBranch?: string;
  after?: string;
  deleted?: boolean;
  commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
}

export interface RegistryPushDeps {
  /** Does `installationId` belong to `owner`? Must fail closed. */
  ownerMatches?: (installationId: number, owner: string) => Promise<boolean>;
}

export type RegistryPushOutcome =
  | { kind: "ignored"; reason: string }
  | { kind: "indexed"; registryId: string; result: "ok" | "error" | "local" }
  | { kind: "swept"; repositoryId: string };

/** The files whose move changes a fleet repo's standing against the registry. */
const STANDARDS_PATHS = new Set([".ai/registry-map.json", ".ai/manifest.yaml", ".ai/manifest.yml"]);

export function touchesStandards(commits: RegistryPush["commits"]): boolean {
  return (commits ?? []).some((c) =>
    [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])].some((p) => STANDARDS_PATHS.has(p)),
  );
}

async function storedMappingMatches(installationId: number, owner: string): Promise<boolean> {
  try {
    return (await getInstallationIdForOwner(owner)) === String(installationId);
  } catch {
    return false;
  }
}

/** Handle one push for the registry lane. Never throws for a routine skip; a thrown error is a bug or an outage. */
export async function onRegistryPush(push: RegistryPush, deps: RegistryPushDeps = {}): Promise<RegistryPushOutcome> {
  const onDefault = !!push.defaultBranch && push.ref === `refs/heads/${push.defaultBranch}`;
  const headMoved = !push.deleted && !!push.after && !/^0+$/.test(push.after);
  if (!onDefault || !headMoved) return { kind: "ignored", reason: "not a default-branch head move" };

  const slug = push.owner.toLowerCase();
  const fullName = `${push.owner}/${push.repo}`;
  const registries = await listOrgRegistries(slug);
  if (!registries.length) return { kind: "ignored", reason: "no registry mapped" };

  const registry = registries.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
  const fleetMove = !registry && touchesStandards(push.commits);
  if (!registry && !fleetMove) return { kind: "ignored", reason: "not a registry and no .ai/ change" };

  const ownerMatches = deps.ownerMatches ?? storedMappingMatches;
  if (!(await ownerMatches(push.installationId, push.owner))) return { kind: "ignored", reason: "installation not bound to owner" };

  if (registry) return indexOnPush(registry, push.installationId);

  const ref = await resolveRepoJobRef(slug, fullName);
  if (!ref?.repoId) return { kind: "ignored", reason: "repo not imported" };
  const token = await getInstallationToken(push.installationId);
  await sweepConformance(slug, token, { repositoryId: ref.repoId });
  return { kind: "swept", repositoryId: ref.repoId };
}

async function indexOnPush(registry: OrgRegistryRow, installationId: number): Promise<RegistryPushOutcome> {
  await markRegistryWebhookSeen(registry.id);
  if (localRegistryDir(registry)) return { kind: "indexed", registryId: registry.id, result: "local" };
  const token = await getInstallationToken(installationId);
  const result = await runIndexPass(registry, githubSource(token, registry.fullName), "trail");
  return { kind: "indexed", registryId: registry.id, result: result.kind };
}
