// Wiring the real world into the headless cycle.
//
// The same split `src/app/api/athena/gate.ts` makes for the interactive turn, and for the same
// reason: `route.ts` authorizes and reports, `cycle.ts` decides, and this file is composition only —
// no rule about what she does lives here.
//
// WHAT IS DELIBERATELY ABSENT FROM THIS FILE: any writer for `AthenaIdentity`. `OrgCycleDeps` has no
// slot for one, `athena-identity.ts` exposes no writer for the constitution at all, and the only
// identity function reached below is the READER (`getAthenaIdentityPair`). An unattended pass that
// could edit who she is would be a companion who rewrites herself while nobody is looking.
//
// `src/lib/athena/cycle.test.ts` asserts that absence at the SOURCE level, by name — which is why the
// self-model writer's identifier is not spelled out anywhere in this file, not even in a comment. A
// guard that a passing mention can trip is a guard that gets weakened the first time it fires.

import { athenaActionSummary, type AthenaActionParamValues } from "@/lib/athena/actions";
import { ATHENA_CYCLE_BUDGET_MS, type OrgCycleDeps } from "@/lib/athena/cycle";
import type { CycleOpenProposal, CycleStanding } from "@/lib/athena/cycle-prompt";
import {
  appendAthenaTurn,
  createAthenaThread,
  getAthenaIdentityPair,
  latestAthenaActivity,
  listOpenAthenaProposals,
  writeAthenaEpisode,
} from "@/lib/db/athena";
import { getOrgMovers, getOrgRollup } from "@/lib/db";
import { levelForScore } from "@/lib/maturity/model";
import { runToolLoop } from "@/lib/llm/tool-loop";
import { resolveWindow, weekRangeParams } from "@/lib/window";

/** Open asks named in the prompt. Enough to stop her re-proposing; not a backlog dump. */
const OPEN_PROPOSAL_LIMIT = 8;
/** Movers named in the standing. Both directions, biggest first. */
const MOVER_LIMIT = 3;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The card's sentence, resolved from the action spec — or the bare kind when the action is retired. */
function summarize(kind: string, payload: Record<string, unknown>): string {
  const params = isRecord(payload.params) ? (payload.params as AthenaActionParamValues) : {};
  return athenaActionSummary(kind, params) ?? kind;
}

const daysSince = (iso: string, now: number): number =>
  Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000));

export function buildOrgCycleDeps(ctx: { org: string; orgId: string; signal?: AbortSignal }): OrgCycleDeps {
  const { org, orgId } = ctx;
  return {
    landing: () => latestAthenaActivity(orgId),

    standing: async (): Promise<CycleStanding | null> => {
      // The SAME trailing-week window the weekly digest resolves (`weekRangeParams` → `resolveWindow`),
      // so the period movement she briefs on and the one the digest pushes cannot disagree about where
      // the week started. Without a window there is no baseline at all, and `deltas` would be null on
      // every run — which would make "the standing moved" unreachable in report-or-absorb.
      const window = resolveWindow(weekRangeParams());
      const rollup = await getOrgRollup(org, { start: window.start, endExclusive: window.endExclusive });
      if (!rollup || rollup.scannedCount === 0) return null;
      const movers = await getOrgMovers(org, { start: window.start, endExclusive: window.endExclusive }).catch(() => null);
      const both = [...(movers?.gainers ?? []).slice(0, MOVER_LIMIT), ...(movers?.regressers ?? []).slice(0, MOVER_LIMIT)];
      return {
        repoCount: rollup.repoCount,
        scannedCount: rollup.scannedCount,
        avgOverall: rollup.avgOverall,
        level: levelForScore(rollup.avgOverall).name,
        overallDelta: rollup.deltas?.overall ?? null,
        cohortSize: rollup.movement?.cohortSize ?? null,
        movers: both.map((m) => ({ name: m.name, delta: m.dOverall })),
      };
    },

    openProposals: async (): Promise<CycleOpenProposal[]> => {
      const now = Date.now();
      const rows = await listOpenAthenaProposals(orgId, OPEN_PROPOSAL_LIMIT);
      return rows.map((p) => ({
        id: p.id,
        kind: p.kind,
        summary: summarize(p.kind, p.payload),
        ageDays: daysSince(p.createdAt, now),
      }));
    },

    identity: async () => {
      const pair = await getAthenaIdentityPair(orgId);
      return { constitution: pair.constitution?.content ?? null, selfModel: pair.selfModel?.content ?? null };
    },

    // ONE metered call: no tools, one leg. The standing and the open asks are already in the prompt,
    // and an unattended pass is the last place an unbounded tool loop belongs. `legKind: "athena_cycle"`
    // is what keeps this spend separable from her interactive turns in /usage and in tracklight.
    runLoop: (req) =>
      runToolLoop({
        prompt: req.prompt,
        tools: [],
        execute: async () => "",
        legKind: "athena_cycle",
        orgSlug: org,
        signal: req.signal,
        maxLegs: 1,
        budgetMs: ATHENA_CYCLE_BUDGET_MS,
      }),

    land: async (input) => {
      // The thread is MINTED HERE, not before the model call — but the DECISION that there is a
      // landing was made before it (`landing()` returned a record, so this org has a reachable store).
      // Minting earlier would leave an empty, permanently untitled thread behind every absorbed run.
      let threadId = input.threadId;
      if (!threadId) {
        const thread = await createAthenaThread(orgId, input.title);
        if (!thread) return null;
        threadId = thread.id;
      }
      const turn = await appendAthenaTurn({
        orgId,
        threadId,
        role: "assistant",
        content: input.content,
        meta: input.meta,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        legs: input.legs,
        proposals: input.proposals,
      });
      return turn ? { threadId, turnId: turn.id } : null;
    },

    writeEpisode: (input) => writeAthenaEpisode({ orgId, ...input }),
  };
}
