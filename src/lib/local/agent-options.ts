// WHAT THE AGENT MAY BE RUN AS — the model and the reasoning effort, as a value both the browser and
// the server can hold.
//
// The loop's agent was pinned to `CLAUDE_MODEL` (default `sonnet`) with no per-run choice, which made
// the most expensive variable in the whole system the one thing an operator could not vary without a
// redeploy. The point is not "let people pick a bigger model": it is that a lift measured on sonnet at
// default effort and a lift measured on opus at high effort are results from two different setups, and
// until the setup is recorded beside the lift there is no way to tell them apart — the loop's own
// ledger was comparing runs whose configuration it did not know.
//
// This module is deliberately DEPENDENCY-FREE (no `process`, no `node:*`): the cockpit's select and
// the API route's validator have to agree exactly, and the way that stops being true is two lists.
// Environment resolution lives in `agent.ts`, which the browser never loads.

/** Reasoning effort, as the `claude` CLI's `--effort` accepts it. */
export type AgentEffort = "low" | "medium" | "high";

/**
 * The models a run may be armed with.
 *
 * A closed list rather than a free text field, and not because the CLI cares: `--model` is passed
 * through a shell on Windows (`agent.ts`), so an unvalidated value is an argument-injection surface.
 * An operator who needs a pinned model id sets `CLAUDE_MODEL` and picks "default" — which is also the
 * honest reading, since a pinned id is a deployment decision rather than a per-run one.
 */
export const AGENT_MODELS = ["haiku", "sonnet", "opus"] as const;
export type AgentModel = (typeof AGENT_MODELS)[number];

export const AGENT_EFFORTS = ["low", "medium", "high"] as const;

/** What a run was armed with. Both `null` = "whatever the deployment's env says". */
export interface AgentConfig {
  model?: string | null;
  effort?: string | null;
}

/** A model the picker and the route both accept, or null for "use the deployment default". */
export function normalizeAgentModel(v: unknown): AgentModel | null {
  return typeof v === "string" && (AGENT_MODELS as readonly string[]).includes(v) ? (v as AgentModel) : null;
}

/** An effort level both ends accept, or null for "don't pass the flag at all". */
export function normalizeAgentEffort(v: unknown): AgentEffort | null {
  return typeof v === "string" && (AGENT_EFFORTS as readonly string[]).includes(v) ? (v as AgentEffort) : null;
}

/**
 * The one line a ledger prints so two runs can be compared: `opus · high effort`, `sonnet`, or null
 * when nothing is known. Null renders NOTHING rather than "default" — a run recorded before this
 * existed has an unknown configuration, and "default" would be a claim about it.
 */
export function agentConfigLabel(cfg: AgentConfig | null | undefined): string | null {
  const model = cfg?.model?.trim();
  const effort = cfg?.effort?.trim();
  if (!model && !effort) return null;
  return [model, effort ? `${effort} effort` : null].filter(Boolean).join(" · ");
}
