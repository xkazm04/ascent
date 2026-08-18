// The display/scope config threaded through the tech-stacks analysis components (StackProfiles /
// StackInsights / playbooks): the entity noun they show and the URL scope query their onward/handoff
// links use. Kept as a tiny object so the noun + `?stack=` query live in one place.

import { stackScopeQ } from "@/features/standing/tech-stacks/stackViz";

export interface AnalysisScope {
  /** Singular entity noun. */
  noun: string;
  /** Plural entity noun. */
  nounPlural: string;
  /** The `?scope=<id>` query (or "" for the whole fleet) used by the onward/handoff links. */
  scopeQ: (id: string | null) => string;
}

export const STACK_SCOPE: AnalysisScope = {
  noun: "stack",
  nounPlural: "stacks",
  scopeQ: stackScopeQ,
};
