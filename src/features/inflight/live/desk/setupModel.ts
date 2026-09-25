// 05 NEXT ROUND SETUP — a draft ticket, prefilled from the newest round and the last runner's dials.
// Pure: the reducer below is the whole behaviour; the component only renders it and persists the
// draft in this browser. Nothing here dispatches: the desk hands the operator to the Cockpit.
//
// Prefill sources, most specific first: the newest round (repos, arm, cycles, plan mode), then the last
// runner (batch, ceiling, verify); what neither recorded is the engine's own default (batch 5, verify
// on) — the defaults the run route applies, not a guess.

import type { DeskData } from "./deskTypes";
import { ARM_UNRECORDED, armKeyOf, type ArmRow } from "./armsModel";
import type { DeskRound } from "./roundsModel";
import { MICROS_PER_USD } from "./deskFormat";

export type ArmPolicy = "single" | "compare";

export interface SetupDraft {
  repos: string[];
  arms: string[];
  policy: ArmPolicy;
  cycles: number;
  batch: number;
  /** Whole dollars. */
  ceiling: number;
  verify: boolean;
  plan: boolean;
}

export const LIMITS = { cycles: [1, 5], batch: [1, 8], ceiling: [10, 500] } as const;
export type StepKey = keyof typeof LIMITS;
export const STEP = { cycles: 1, batch: 1, ceiling: 10 } as const;
const MAX_COMPARE = 4;
const ENGINE_BATCH = 5;
const DEFAULT_CEILING = 100;

export const isSplit = (armKey: string): boolean => armKey.includes(" -> ");

export interface RepoOption {
  repo: string;
  lastSeq: number | null;
  paired: boolean;
}

/** Every repo a round could target: the paired checkouts first, then any repo the history names. */
export function repoOptions(data: DeskData, rounds: readonly DeskRound[]): RepoOption[] {
  const lastSeq = new Map<string, number | null>();
  for (const r of rounds) for (const repo of r.repos) lastSeq.set(repo, r.seq ?? lastSeq.get(repo) ?? null);
  const paired = new Set(data.pairedRepos);
  const all = [...new Set([...data.pairedRepos, ...lastSeq.keys()])].sort();
  // No pairing at all (a hosted deployment): the checkout question does not apply, every repo is offered.
  return all.map((repo) => ({ repo, lastSeq: lastSeq.get(repo) ?? null, paired: paired.size === 0 || paired.has(repo) }));
}

/** Arms worth offering: every arm the history ran on, except the lanes that never recorded one. */
export const armChoices = (arms: readonly ArmRow[]): ArmRow[] => arms.filter((a) => a.key !== ARM_UNRECORDED);

const clamp = (k: StepKey, v: number) => Math.max(LIMITS[k][0], Math.min(LIMITS[k][1], v));

export function prefill(data: DeskData, rounds: readonly DeskRound[], arms: readonly ArmRow[]): SetupDraft {
  const newest = rounds[rounds.length - 1] ?? null;
  const choices = armChoices(arms).map((a) => a.key);
  const newestArms = [...new Set((newest?.lanes ?? []).map(armKeyOf))].filter((k) => choices.includes(k));
  const runner = data.ledger.runner ?? data.ledger.lastRunner;
  const dials = runner?.dials ?? null;
  const ceilingMicros = runner?.spendCeilingMicros ?? null;
  const paired = new Set(data.pairedRepos);
  const repos = (newest?.repos ?? []).filter((r) => paired.size === 0 || paired.has(r));
  return {
    repos,
    arms: newestArms.length ? newestArms.slice(0, MAX_COMPARE) : choices.slice(0, 1),
    policy: newestArms.length > 1 ? "compare" : "single",
    cycles: clamp("cycles", newest?.maxCycles ?? 1),
    batch: clamp("batch", dials?.batchSize ?? ENGINE_BATCH),
    ceiling: clamp("ceiling", ceilingMicros != null ? Math.round(ceilingMicros / MICROS_PER_USD) : DEFAULT_CEILING),
    verify: dials?.verifyMode !== "off",
    plan: dials?.planMode === "on" || newestArms.some(isSplit),
  };
}

export type SetupAction =
  | { type: "repo"; repo: string }
  | { type: "arm"; arm: string }
  | { type: "policy"; policy: ArmPolicy }
  | { type: "step"; key: StepKey; delta: number }
  | { type: "toggle"; key: "verify" | "plan" }
  | { type: "reset"; draft: SetupDraft };

export function reduceSetup(d: SetupDraft, a: SetupAction): SetupDraft {
  switch (a.type) {
    case "repo":
      return { ...d, repos: d.repos.includes(a.repo) ? d.repos.filter((r) => r !== a.repo) : [...d.repos, a.repo] };
    case "arm": {
      if (d.policy === "single") return { ...d, arms: [a.arm] };
      if (d.arms.includes(a.arm)) return d.arms.length > 1 ? { ...d, arms: d.arms.filter((x) => x !== a.arm) } : d;
      return d.arms.length < MAX_COMPARE ? { ...d, arms: [...d.arms, a.arm] } : d;
    }
    case "policy":
      return { ...d, policy: a.policy, arms: a.policy === "single" ? d.arms.slice(0, 1) : d.arms };
    case "step":
      return { ...d, [a.key]: clamp(a.key, d[a.key] + a.delta) };
    case "toggle":
      return { ...d, [a.key]: !d[a.key] };
    case "reset":
      return a.draft;
  }
}

/** A split arm plans with one model and executes with another: plan mode cannot be off. */
export const planForced = (d: SetupDraft): boolean => d.arms.some(isSplit);
export const planOn = (d: SetupDraft): boolean => d.plan || planForced(d);

/** A saved draft from this browser, accepted only when it still has the draft's shape. */
export function parseDraft(raw: string | null): SetupDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SetupDraft>;
    const strs = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === "string");
    const nums = [v.cycles, v.batch, v.ceiling].every((n) => typeof n === "number" && Number.isFinite(n));
    if (!strs(v.repos) || !strs(v.arms) || !nums || (v.policy !== "single" && v.policy !== "compare")) return null;
    return {
      repos: v.repos!,
      arms: v.arms!,
      policy: v.policy,
      cycles: clamp("cycles", v.cycles!),
      batch: clamp("batch", v.batch!),
      ceiling: clamp("ceiling", v.ceiling!),
      verify: v.verify !== false,
      plan: v.plan === true,
    };
  } catch {
    return null;
  }
}
