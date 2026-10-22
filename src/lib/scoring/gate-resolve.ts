// THE ONE EFFECTIVE-POLICY RESOLVER. `gate.ts` declares the gate's policy as one ordered fold:
//
//   effective = tighten(tighten(tighten(org ?? archetype, admission), manifest), params)
//
// and until this module existed every surface hand-sequenced it. Two remembered the admission layer
// (the public endpoint, the Check Run) and two did not (the governance fleet view, the MCP
// `get_gate_verdict`), so an admitted T0/T1/T2 or `blocked` repo was held to a stricter bar by the
// merge-blocking check than the dashboard pass rate and the agent-facing verdict admitted. Two places
// computing precedence is two policies (quality-gates/policy-projection). Every surface now asks here.
//
// `tightenGatePolicy` is called only in this module and in `gate.ts` - a source-scanning test pins it -
// so the manifest layer (#5) lands as one more step below instead of a fifth call-site edit.
//
// The ORG-POLICY READ stays at each caller on purpose: each surface owns a distinct fail-closed
// response to it (a 503 body, a failing "could not run" check, a tab error) and the tenancy lookup
// that precedes it. What every caller shares - the admission read and the fold - lives here, and it
// keeps the admission seam's rules: tighten-only, and a read error THROWS (never a weaker bar).

import { defaultGatePolicy, describeGatePolicy, tightenGatePolicy, type GatePolicy } from "@/lib/scoring/gate";
import { resolveAdmissionLayer, type AdmissionVerdictInfo } from "@/lib/scoring/gate-admission";
import { admissionGateOverlay, type RepoAdmissionRow } from "@/lib/org/admission";
import { listOrgAdmissions } from "@/lib/db/org-admission";
import type { RepoArchetype } from "@/lib/types";

/** The layers that actually contributed to an effective policy, in fold order. */
export type GatePolicyLayer = "org" | "archetype" | "admission" | "params";

/** Query-param policy, as parsed (`explicit`) and padded with archetype defaults (`padded`). The
 *  padded form is a thunk: it is only built on the no-org-bar branch, so archetype defaults can never
 *  dilute an existing org policy (route.test pins that policyFromParams is not even called). */
export interface GateParamsLayer {
  explicit: GatePolicy;
  padded: () => GatePolicy;
}

export interface FoldInput {
  /** The persisted org bar, or null/undefined when none is stored (the archetype default applies). */
  orgPolicy: GatePolicy | null | undefined;
  archetype: RepoArchetype;
  /** The admission overlay; `{}` when no row applied. */
  overlay: GatePolicy;
  /** Query params. Absent on every surface but the public endpoint. */
  params?: GateParamsLayer;
}

export interface ResolvedGatePolicy {
  policy: GatePolicy;
  layers: GatePolicyLayer[];
}

const nonEmpty = (p: GatePolicy | undefined): boolean => !!p && Object.keys(p).length > 0;

/**
 * The pure fold. With an org bar: tighten(tighten(org, admission), params). With NO org bar and query
 * params, the params keep their historical per-field override of the archetype default (`padded`)
 * and the admission overlay tightens that - the public endpoint's byte-identical branch, preserved
 * exactly. Without params: tighten(org ?? archetype, admission).
 */
export function foldGatePolicy(i: FoldInput): ResolvedGatePolicy {
  const layers: GatePolicyLayer[] = [i.orgPolicy ? "org" : "archetype"];
  let policy: GatePolicy;
  if (i.orgPolicy) {
    policy = tightenGatePolicy(i.orgPolicy, i.overlay);
    if (i.params) policy = tightenGatePolicy(policy, i.params.explicit);
  } else if (i.params) {
    policy = tightenGatePolicy(i.params.padded(), i.overlay);
  } else {
    policy = tightenGatePolicy(defaultGatePolicy(i.archetype), i.overlay);
  }
  if (nonEmpty(i.overlay)) layers.push("admission");
  if (i.params && nonEmpty(i.params.explicit)) layers.push("params");
  return { policy, layers };
}

export interface RepoGatePolicy extends ResolvedGatePolicy {
  /** Null when no admission row applied, so a verdict body can omit the key. */
  admission: AdmissionVerdictInfo | null;
}

/**
 * One repo's effective policy: reads the admission layer through the shared seam, then folds.
 * THROWS when the admission row cannot be read - the caller fails closed (503 / failing check).
 */
export async function resolveRepoGatePolicy(a: {
  orgSlug: string;
  repoFullName: string;
  orgPolicy: GatePolicy | null | undefined;
  archetype: RepoArchetype;
  params?: GateParamsLayer;
}): Promise<RepoGatePolicy> {
  const layer = await resolveAdmissionLayer(a.orgSlug, a.repoFullName);
  const folded = foldGatePolicy({ orgPolicy: a.orgPolicy, archetype: a.archetype, overlay: layer.overlay, params: a.params });
  return { ...folded, admission: layer.admission };
}

/** The overlay a fleet admission row compiles to - the same rule `resolveAdmissionLayer` applies
 *  (the GRANTED tier, and only when a tier was assessed at all). */
export function overlayForAdmissionRow(row: RepoAdmissionRow): GatePolicy {
  return admissionGateOverlay(row.mode, row.derivedTier !== null ? row.grantedTier : null);
}

export interface FleetGatePolicies {
  /** The org-wide bar before any per-repo layer (what the CI snippet and gate URL advertise). */
  base: GatePolicy;
  policyFor(fullName: string): GatePolicy;
  layersFor(fullName: string): GatePolicyLayer[];
}

/**
 * Every repo's effective policy for one org, from ONE `listOrgAdmissions` read (no N+1). The org
 * policy is passed in (each caller owns that read). THROWS when the admission list cannot be read;
 * the fleet view reports that as `admissionUnread`, the MCP verdict refuses.
 */
export async function resolveFleetGatePolicies(
  orgSlug: string,
  orgPolicy: GatePolicy | null | undefined,
  archetype: RepoArchetype,
): Promise<FleetGatePolicies> {
  return fleetFromRows(orgPolicy, archetype, await listOrgAdmissions(orgSlug));
}

/** The pure half of the fleet resolver (also the degraded no-admission view). */
export function fleetFromRows(
  orgPolicy: GatePolicy | null | undefined,
  archetype: RepoArchetype,
  rows: RepoAdmissionRow[],
): FleetGatePolicies {
  const base = foldGatePolicy({ orgPolicy, archetype, overlay: {} });
  const byRepo = new Map<string, ResolvedGatePolicy>();
  for (const row of rows) {
    const overlay = overlayForAdmissionRow(row);
    if (nonEmpty(overlay)) byRepo.set(row.repoFullName.toLowerCase(), foldGatePolicy({ orgPolicy, archetype, overlay }));
  }
  const get = (fullName: string) => byRepo.get(fullName.toLowerCase()) ?? base;
  return {
    base: base.policy,
    policyFor: (fullName) => get(fullName).policy,
    layersFor: (fullName) => get(fullName).layers,
  };
}

/**
 * The fleet view's read: never throws, but an unreadable admission list comes back as `unread: true`
 * over the org bar alone, so the caller can say so instead of presenting a looser bar as the CI one.
 */
export async function readFleetGatePolicies(
  orgSlug: string,
  orgPolicy: GatePolicy | null | undefined,
  archetype: RepoArchetype,
): Promise<FleetGatePolicies & { unread: boolean }> {
  try {
    return { ...(await resolveFleetGatePolicies(orgSlug, orgPolicy, archetype)), unread: false };
  } catch (err) {
    console.error("[gate] fleet admission read failed - judged on the org bar alone", err instanceof Error ? err.message : err);
    return { ...fleetFromRows(orgPolicy, archetype, []), unread: true };
  }
}

// The GitHub Action `with:` lines that enforce a policy in CI (the governance tab's snippet).
/** Bars the token-less /api/gate cannot measure: it answers 503 when a request names them, so a snippet
 *  that passed them would error on every run. The Ascent GitHub App check run (which holds a token)
 *  enforces them instead; the action keeps the inputs for callers who run their own gate endpoint. */
const APP_CHECK_ONLY_CI = ["require-protection", "min-ai-governed"];
const APP_CHECK_COMMENT = "# require-protection / min-ai-governed are enforced by the Ascent GitHub App check run, not here";

export function ciWith(p: GatePolicy): string[] {
  const lines = describeGatePolicy(p).flatMap((c) => (c.ci ? [c.ci] : []));
  const keep = lines.filter((l) => !APP_CHECK_ONLY_CI.includes(l.split(":")[0] ?? ""));
  return keep.length === lines.length ? keep : [...keep, APP_CHECK_COMMENT];
}
