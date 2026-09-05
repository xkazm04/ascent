// The preamble every Athena route runs, and the wiring that turns the headless turn's injected
// dependencies into the real store, the real gate and the real model.
//
// This file exists so `route.ts` files stay thin. A route's job is to authorize, adapt and respond;
// the moment it also knows how memory is ranked and which provider answers, the interesting half of
// the feature is only reachable through an HTTP request. Everything here is composition — no rule
// about how Athena behaves is decided in this file.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { canReadOrg, requireOrgAccess, requireOrgRead } from "@/lib/authz";
import { dbGuard } from "@/lib/api/orgPlan";
import {
  candidateOrgMemories,
  getCreditState,
  getOrgId,
  workspaceAllowsMemory,
  workspaceAllowsSkills,
  type MemoryRow,
} from "@/lib/db";
import {
  appendAthenaTurn,
  getAthenaIdentityPair,
  listAthenaTurns,
  writeAthenaEpisode,
} from "@/lib/db/athena";
import { recallMemories } from "@/lib/memory/recall";
import { runTool } from "@/lib/mcp/handlers";
import { runToolLoop } from "@/lib/llm/tool-loop";
import { supportsToolCalling } from "@/lib/llm/config";
import { resolveLegRunnerForOrg } from "@/lib/llm/text-org";
import { createAthenaGrounding } from "@/lib/athena/grounding";
import { ATHENA_HISTORY_TURNS } from "@/lib/athena/prompt";
import type { AthenaTurnDeps } from "@/lib/athena/turn";

export interface AthenaOrgContext {
  org: string;
  orgId: string;
}

const isResponse = (v: unknown): v is NextResponse => v instanceof Response;

/** True when `gateAthenaOrg` refused. Kept as a helper so a route can never forget the check. */
export const refused = isResponse;

/**
 * DB guard → `org` → PUBLIC_ORG refusal → authz gate → resolve the tenant id.
 *
 * The public funnel org is refused EXPLICITLY rather than falling out of the authz gate (which lets
 * `public` through by design, since anyone may read the public corpus). Athena is an organization's
 * own companion: there is no "public" org to have a constitution, a self-model or a memory, and a
 * thread opened against it would be a conversation nobody owns. Same posture as the follow-ups
 * hand-off route.
 */
export async function gateAthenaOrg(
  orgParam: string | null | undefined,
  mode: "read" | "write",
): Promise<AthenaOrgContext | NextResponse> {
  const guard = dbGuard("Athena", "Athena requires a database.");
  if (guard) return guard;

  const org = typeof orgParam === "string" ? orgParam.trim().toLowerCase() : "";
  if (!org) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  if (org === PUBLIC_ORG) {
    return NextResponse.json(
      { error: "Athena is your own organization's companion. The public corpus does not have one." },
      { status: 403 },
    );
  }

  const denied = mode === "read" ? await requireOrgRead(org) : await requireOrgAccess(org);
  if (denied) return denied;

  // The tenant boundary is enforced twice, as everywhere else in this codebase: the slug is
  // authorized above, and every store call below is ANDed with the id resolved here.
  const orgId = await getOrgId(org);
  if (!orgId) return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  return { org, orgId };
}

export interface AthenaEngineState {
  /** True when no model will answer. She still replies — see ATHENA_NO_ENGINE_REPLY. */
  degraded: boolean;
  engine: string | null;
  model: string | null;
  /** Whether tools will be OFFERED. A provider without function calling grounds from the prompt only. */
  grounding: "tools" | "prefetched";
  /** Present only when the degrade has a nameable cause an operator could act on. */
  reason?: string;
}

/**
 * Probe which engine (if any) would answer, WITHOUT calling it. The boot payload carries this so the
 * client can say "no engine configured" before the operator types a question and waits for a
 * disappointing answer.
 *
 * `resolveLegRunnerForOrg` THROWS when an org's BYOM is active but unresolvable — that is a
 * fail-closed refusal to route the org's content to a provider it never connected, and it must not be
 * flattened into a plain "no engine". The message is surfaced as `reason` so the operator sees the
 * fixable thing (an ENCRYPTION_KEY / credential problem) rather than an unexplained degrade.
 */
export async function probeAthenaEngine(org: string): Promise<AthenaEngineState> {
  try {
    const runner = await resolveLegRunnerForOrg(org, { legKind: "athena_turn" });
    if (!runner) return { degraded: true, engine: null, model: null, grounding: "prefetched" };
    return {
      degraded: false,
      engine: runner.engine,
      model: runner.model,
      grounding: supportsToolCalling(runner.engine) ? "tools" : "prefetched",
    };
  } catch (err) {
    return {
      degraded: true,
      engine: null,
      model: null,
      grounding: "prefetched",
      reason: err instanceof Error ? err.message : "The organization's model provider could not be resolved.",
    };
  }
}

/** How many stored memories are considered before ranking. The ranking, not this number, decides. */
const RECALL_CANDIDATES = 60;
/** Character budget handed to the org's own recall ranking for the prefetched context. */
const RECALL_BUDGET = 2_000;

const STOP_WORDS = new Set(["the", "and", "for", "with", "that", "this", "our", "your", "are", "was", "how", "what", "why", "does", "did", "can", "should"]);

const queryTerms = (q: string): string[] =>
  q
    .toLowerCase()
    .split(/[^a-z0-9/._-]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

/**
 * What she already knew that bears on this message.
 *
 * Relevance is a keyword pre-filter; ORDERING is the org's own recall value model
 * (`src/lib/memory/recall.ts`), not a second ranking invented here. Two rankings over one store would
 * eventually disagree about which memory matters most, and the Memory tab is the one that has to win.
 *
 * NOTE ON accessCount: this recall is a SIDE READ for context, not a delivery to an agent that asked
 * for memory, so `deliveredMemoryIds` is deliberately NOT bumped here. Counting it would inflate the
 * delivery term for every memory that happens to share a word with a chat message, and that term
 * already carries a documented honesty caveat.
 */
async function recallForMessage(org: string, message: string, viewer: string | null) {
  const terms = queryTerms(message);
  if (terms.length === 0) return [];
  let rows: MemoryRow[] = [];
  try {
    rows = await candidateOrgMemories(org, { limit: RECALL_CANDIDATES }, viewer);
  } catch {
    return [];
  }
  const matched = rows.filter((r) => {
    const hay = `${r.content} ${r.tags.join(" ")}`.toLowerCase();
    return terms.some((t) => hay.includes(t));
  });
  if (matched.length === 0) return [];
  const result = recallMemories(matched, { now: Date.now(), charBudget: RECALL_BUDGET });
  return result.selected.map((s) => ({ id: s.memory.id, content: s.memory.content, kind: s.memory.kind }));
}

/**
 * The gates that must be decided IN REQUEST SCOPE, resolved together.
 *
 * `canReadOrg` reads `next/headers` cookies through `getViewer()`, and cookies are NOT readable
 * inside a `ReadableStream`'s `start()` callback — `getViewer()` there returns null, so a live
 * predicate handed to the grounding would refuse every tool on the SSE path and silently ungrounded
 * every streamed answer. The precedent, with the same comment, is `src/app/api/scan/stream/route.ts`.
 *
 * So the DECISION is made here, where it can be, and the booleans are what travel into the stream.
 */
export async function resolveAthenaGates(
  org: string,
): Promise<{ canRead: boolean; memoryAllowed: boolean; skillsAllowed: boolean }> {
  const [canRead, credit] = await Promise.all([canReadOrg(org), getCreditState(org).catch(() => null)]);
  const [memoryAllowed, skillsAllowed] = await Promise.all([
    workspaceAllowsMemory(org, credit?.plan).catch(() => false),
    // #17 (W2-K): the four registry tools are fail-closed until this predicate says otherwise.
    workspaceAllowsSkills(org, credit?.plan).catch(() => false),
  ]);
  return { canRead, memoryAllowed, skillsAllowed };
}

/**
 * Wire the real world into the headless turn.
 *
 * Every gate the grounding needs arrives as a RESOLVED BOOLEAN rather than a live predicate — see
 * `resolveAthenaGates` for why that is not an optimization. `src/lib/athena/grounding.ts` therefore
 * never reaches for `next/headers` and stays testable, and the gate it enforces is the one this
 * request actually evaluated.
 *
 * `canRead` is a SECOND evaluation of the read predicate (the route already ran
 * `requireOrgRead`/`requireOrgAccess`) and it is kept deliberately: `runTool` performs no tenancy
 * check of its own, so the module that dispatches it must not depend on an upstream caller having
 * remembered to gate.
 */
export function buildAthenaTurnDeps(
  ctx: AthenaOrgContext & {
    threadId: string;
    viewer: string | null;
    canRead: boolean;
    memoryAllowed: boolean;
    skillsAllowed?: boolean;
  },
): AthenaTurnDeps {
  const { org, orgId, threadId, viewer, canRead, memoryAllowed, skillsAllowed = false } = ctx;
  return {
    recall: (message) => recallForMessage(org, message, viewer),
    identity: async () => {
      const pair = await getAthenaIdentityPair(orgId);
      return { constitution: pair.constitution?.content ?? null, selfModel: pair.selfModel?.content ?? null };
    },
    history: async () => {
      const turns = await listAthenaTurns(orgId, threadId, ATHENA_HISTORY_TURNS * 2);
      // The turn just persisted the operator's message; replaying it as "earlier in this conversation"
      // above the very same text would tell the model it was asked twice.
      return turns.slice(0, -1).map((t) => ({ role: t.role, content: t.content }));
    },
    grounding: () =>
      createAthenaGrounding(org, {
        canReadOrg: async () => canRead,
        memoryAllowed: async () => memoryAllowed,
        skillsAllowed: async () => skillsAllowed,
        runTool,
      }),
    runLoop: (req) =>
      runToolLoop({
        prompt: req.prompt,
        tools: req.tools,
        execute: req.execute,
        legKind: "athena_turn",
        orgSlug: org,
        signal: req.signal,
      }),
    appendTurn: (input) => appendAthenaTurn({ orgId, threadId, ...input }),
    writeEpisode: (input) => writeAthenaEpisode({ orgId, ...input }),
  };
}
