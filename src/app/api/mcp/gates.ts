// The PLAN gates the agent door resolves once per request (moonshot #17).
//
// WHY THIS FILE EXISTS AT ALL. `POST /api/mcp` checked scopes and nothing else, so an `mcp:read` +
// `memory:read` token reached an org's Shared Memory on ANY plan — while `POST /api/org/memory`,
// answering the same store for the same org, gated on `workspaceAllowsMemory`. Two doors onto one
// resource disagreeing about who may open it is not a difference in strictness, it is a hole: the
// looser door is the effective policy. `src/lib/athena/grounding.ts` named this in a comment and
// deliberately refused to fix another door's authorization from inside itself. This is that door.
//
// SHAPE BORROWED ON PURPOSE. `resolveAthenaGates` (src/app/api/athena/gate.ts) already resolves the
// same decision for the companion: one `getCreditState` read, then the plan predicates, each
// `.catch(() => false)` so a credit-service blip closes the gate rather than opening it. This mirrors
// it and adds the skills predicate, because the new tools read the Skills Library. The two functions
// are deliberately NOT merged: Athena also gates `canReadOrg` on a cookie session, which does not
// exist here — the MCP caller's identity is a bearer token and its org is the token's own org.
//
// SELF-HOSTED. Both predicates run through `plans.ts`, where `selfHosted()` opens every plan gate, so
// a self-hosted install reaches every tool with a locally minted token and no plan at all.

import { getCreditState, workspaceAllowsMemory, workspaceAllowsSkills } from "@/lib/db";

/** Which plan-gated resource families the catalog knows about. */
export type McpPlanGate = "memory" | "skills";

/** One resolved decision per gated family. `true` = the org's plan carries this resource. */
export interface McpGates {
  memory: boolean;
  skills: boolean;
}

/** Every gate open — the shape a self-hosted install or a fully-entitled org resolves to. */
export const ALL_MCP_GATES_OPEN: McpGates = { memory: true, skills: true };

/**
 * Resolve both plan gates for one request. Never throws: every failure path closes the gate, because
 * an agent silently reaching a resource the workspace has not bought is the failure that matters and
 * a refused tool is recoverable (the caller is told the reason — see the route).
 */
export async function resolveMcpGates(orgSlug: string): Promise<McpGates> {
  const credit = await getCreditState(orgSlug).catch(() => null);
  const [memory, skills] = await Promise.all([
    workspaceAllowsMemory(orgSlug, credit?.plan).catch(() => false),
    workspaceAllowsSkills(orgSlug, credit?.plan).catch(() => false),
  ]);
  return { memory, skills };
}

/** Is `gate` open? An ungated tool (`null`/`undefined`) is always open. */
export function gateOpen(gates: McpGates, gate: McpPlanGate | null | undefined): boolean {
  if (!gate) return true;
  return gates[gate];
}

/**
 * Why a plan-closed tool was refused, in words the caller can act on.
 *
 * DELIBERATELY EXPLICIT, unlike the scope refusal. An out-of-scope tool is answered with the opaque
 * `Unknown tool` so the door cannot be used to enumerate what an org has that this token cannot
 * reach. A plan refusal is different in kind: the caller already holds THIS org's own token, so it
 * has already proven it belongs here, and "the workspace's plan does not include Shared Org Memory"
 * is a fact somebody can fix. Hiding it would only make the agent report a capability as broken.
 */
export function planRefusal(gate: McpPlanGate): string {
  return gate === "memory"
    ? "Shared Org Memory is not included in this workspace's plan, so there is nothing recorded here that this door can read or write. Nothing is hidden from you — the store is not enabled."
    : "The Skills Library is not included in this workspace's plan, so this organization has no curated skills for this door to serve. Nothing is hidden from you — the library is not enabled.";
}
