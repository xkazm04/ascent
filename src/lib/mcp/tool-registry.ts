// THE ONE TOOL REGISTRY - every catalog name bound to its handler and to whether it needs a holder.
//
// The catalog (tools.ts) says what a tool IS on the wire. This table says what RUNS for it, and it
// is keyed by the catalog's own names so the two cannot drift: the structural test pins the keys to
// `MCP_TOOLS`, so a tool added to the catalog without a binding, or a binding left behind by a
// removed tool, fails the suite rather than answering "Unknown tool" in production. Before this,
// `runTool` kept a switch that re-listed every name, and "needs a named holder" was a ternary
// repeated per arm. Both doors (the MCP route and Athena's in-process grounding) now read the same
// table: dispatch looks the binding up, and Athena withholds every tool whose binding needs a holder
// she does not have.
//
// HOLDER, NOT SCOPE. `holder: true` means the handler acts on the work queue on behalf of a named
// caller (a claim has a holder, a brief is only for rows that holder holds, an attempt is that
// holder's account). It is declared here, beside the handler that needs it, instead of inferred from
// a `followups:write` scope that a future work tool might not carry. A holder tool reached with no
// principal fails closed in `runTool`; the binding's `run` is typed to receive one.
//
// No wire change: nothing here is serialized. `tools/list` is still built from tools.ts alone.

import type { McpPrincipal, RunToolOptions } from "./handlers";
import {
  aiStance,
  gateVerdict,
  openRecommendations,
  practiceShape,
  recallMemory,
  repoStanding,
} from "./handlers";
import { compareAgainstExemplar } from "./exemplar-tool";
import { findSkills, getGoverningSubject, getSkill, getSkillLessons } from "./registry-reads";
import { citeMemory, reportSkillInvoke } from "./registry-writes";
import { claimFollowupsTool, getFixBriefTool, reportAttemptTool } from "./work-tools";
import type { Args, ToolResult } from "./tool-result";

/** A tool that acts for a named holder: `runTool` refuses it before `run` when no principal came. */
export interface HolderBinding {
  holder: true;
  run: (org: string, args: Args, principal: McpPrincipal, opts: RunToolOptions) => Promise<ToolResult>;
}

/** A tool whose answer is the same whoever asked. */
export interface OpenBinding {
  holder: false;
  run: (org: string, args: Args, principal: McpPrincipal | undefined, opts: RunToolOptions) => Promise<ToolResult> | ToolResult;
}

export type McpToolBinding = HolderBinding | OpenBinding;

// Every `run` is an arrow that resolves its handler at CALL time. handlers.ts imports this table for
// `runTool`, and this table imports handlers.ts for the fleet handlers; deferring the reference makes
// that cycle safe whichever module a bundler evaluates first.
export const MCP_TOOL_BINDINGS: Readonly<Record<string, McpToolBinding>> = {
  claim_followups: { holder: true, run: (org, args, p) => claimFollowupsTool(org, args, p) },
  get_fix_brief: { holder: true, run: (org, args, p) => getFixBriefTool(org, args, p) },
  report_attempt: { holder: true, run: (org, args, p) => reportAttemptTool(org, args, p) },
  report_skill_invoke: { holder: false, run: (org, args) => reportSkillInvoke(org, args, Date.now()) },
  cite_memory: { holder: false, run: (org, args) => citeMemory(org, args) },
  find_skills: { holder: false, run: (org, args) => findSkills(org, args) },
  get_skill: { holder: false, run: (org, args) => getSkill(org, args) },
  get_skill_lessons: { holder: false, run: (org, args) => getSkillLessons(org, args) },
  get_governing_subject: { holder: false, run: (org, args) => getGoverningSubject(org, args) },
  compare_against_exemplar: { holder: false, run: (org, args) => compareAgainstExemplar(org, args) },
  get_repo_standing: { holder: false, run: (org, args) => repoStanding(org, args) },
  get_gate_verdict: { holder: false, run: (org, args) => gateVerdict(org, args) },
  list_open_recommendations: { holder: false, run: (org, args) => openRecommendations(org, args) },
  get_ai_stance: { holder: false, run: (org, args) => aiStance(org, args) },
  get_practice_shape: { holder: false, run: (_org, args) => practiceShape(args) },
  recall_org_memory: { holder: false, run: (org, args, _p, opts) => recallMemory(org, args, opts) },
};

/** The binding for `name`, or null for a name the catalog does not carry. */
export function toolBinding(name: string): McpToolBinding | null {
  return Object.prototype.hasOwnProperty.call(MCP_TOOL_BINDINGS, name) ? MCP_TOOL_BINDINGS[name] ?? null : null;
}
