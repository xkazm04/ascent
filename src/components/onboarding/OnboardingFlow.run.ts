// The wizard's ONE run model (first-run-onboarding-wizard#A). Pure: no React, no fetch, no storage.
//
// A run used to be spread over a dozen useStates plus three hand-kept lists that had to agree and had
// drifted apart: the resetRun setter list (which never cleared the source, so "Scan another" rewrote
// the old snapshot), the snapshot field list (which recorded where the user was but not what the run
// was, so a re-attached run lost its plan) and the "has this row settled?" predicate, written nine
// times in three variants (the ScanStep variants ignored `completed`, the state only a re-attach
// produces). Here each of those is one definition: `initialRun()` is the reset, `rowSettled` is the
// settle rule, and the snapshot codec carries the plan and consent under a schema version.

import type { ScanRow } from "@/components/onboarding/OnboardingScanRow";
import type { ScanGate } from "@/components/onboarding/scanGate";
import type { ImportNotice } from "@/components/onboarding/skipReason";
import type { OrgCredit, Phase, ResumeSnapshot, RunConsent, RunPlan } from "@/components/onboarding/OnboardingFlow.model";

type Rows = Record<string, ScanRow>;
/** A value or an updater over the current value (the setState contract, without importing React). */
export type Update<T> = T | ((cur: T) => T);

export interface RunState {
  phase: Phase;
  rows: Rows;
  /** An access gate from the import kickoff, rendered as a recovery step. */
  gate: ScanGate | null;
  /** The settled balance for the App-path source (feeds the cost copy and the money gate). */
  credit: OrgCredit | null;
  /** The run's resolved plan; null until resolveScanMode has answered (or on a v1 re-attach). */
  plan: RunPlan | null;
  /** The select-step consent the run started with; null before a run starts. */
  consent: RunConsent | null;
  notices: ImportNotice[];
  /** The server-side run handle from the stream's `queued` frame (persisted for re-attach). */
  runId: string | null;
  /** Restored from a snapshot rather than started here: follow the run, nothing to cancel. */
  reattached: boolean;
  invitedCount: number;
}

export function initialRun(): RunState {
  return { phase: "pick", rows: {}, gate: null, credit: null, plan: null, consent: null, notices: [], runId: null,
    reattached: false, invitedCount: 0 };
}

// ── The row vocabulary ─────────────────────────────────────────────────────────────────────────────

/** THE settle rule: a row is terminal once it scored, errored, was skipped, or finished unseen. */
export function rowSettled(row: ScanRow): boolean {
  return Boolean(row.level || row.error || row.skipped || row.completed);
}

export function runProgress(rows: Rows): { completed: number; total: number; pct: number } {
  const all = Object.values(rows);
  const completed = all.filter(rowSettled).length;
  const total = all.length;
  return { completed, total, pct: total ? Math.round((completed / total) * 100) : 0 };
}

/** Repos with a saved scan: scored here, or finished server-side (a re-attached `completed` row). */
export function reportableRepos(rows: Rows): string[] {
  return Object.values(rows)
    .filter((r) => (r.level || r.completed) && !r.error && !r.skipped)
    .map((r) => r.repo);
}

/** Resolve every unsettled row to `reason` (the stream or the queue is over; nothing else will come). */
export function settleLeftovers(rows: Rows, reason: string): Rows {
  const next: Rows = {};
  for (const [key, r] of Object.entries(rows)) next[key] = rowSettled(r) ? r : { ...r, skipped: reason };
  return next;
}

/** The done-screen disclosures, read off the recorded plan (no plan = today's safe defaults). */
export function runMode(run: RunState) {
  return {
    previewScan: run.plan ? run.plan.mock : true,
    modeResolved: run.plan !== null,
    upgradePlanned: run.plan?.upgradeAfter ?? false,
    previewCause: run.plan?.previewCause ?? null,
  };
}

// ── The reducer ────────────────────────────────────────────────────────────────────────────────────

export type RunAction =
  | { type: "reset" }
  | { type: "phase"; phase: Phase }
  | { type: "rows"; update: Update<Rows> }
  | { type: "gate"; gate: ScanGate | null }
  | { type: "credit"; credit: OrgCredit | null }
  | { type: "invited"; update: Update<number> }
  | { type: "start"; repos: string[]; consent: RunConsent }
  | { type: "plan"; plan: RunPlan }
  | { type: "queued"; runId: string }
  | { type: "repo"; row: ScanRow }
  | { type: "notice"; notice: ImportNotice }
  | { type: "result"; runId?: string; reason: string }
  | { type: "resume"; repos: string[]; runId: string | null; plan: RunPlan | null; consent: RunConsent | null }
  | { type: "reattachRows"; rows: ScanRow[] }
  | { type: "reattachSettled" };

const apply = <T>(cur: T, u: Update<T>): T => (typeof u === "function" ? (u as (c: T) => T)(cur) : u);
const pending = (repos: string[]): Rows => Object.fromEntries(repos.map((repo) => [repo, { repo }]));

export function runReducer(s: RunState, a: RunAction): RunState {
  switch (a.type) {
    case "reset":
      return initialRun();
    case "phase":
      return { ...s, phase: a.phase };
    case "rows":
      return { ...s, rows: apply(s.rows, a.update) };
    case "gate":
      return { ...s, gate: a.gate };
    case "credit":
      return { ...s, credit: a.credit };
    case "invited":
      return { ...s, invitedCount: apply(s.invitedCount, a.update) };
    case "start":
      // A new run: nothing of the previous one's rows, notices, handle or plan survives. The plan stays
      // null until the money gate answers, so no duration is stated off a stale mode.
      return { ...s, phase: "scanning", rows: pending(a.repos), gate: null, notices: [], runId: null,
        reattached: false, plan: null, consent: a.consent };
    case "plan":
      return { ...s, plan: a.plan };
    case "queued":
      return { ...s, runId: a.runId };
    case "repo":
      return { ...s, rows: { ...s.rows, [a.row.repo]: a.row } };
    case "notice":
      return { ...s, notices: [...s.notices, a.notice] };
    case "result":
      return { ...s, runId: a.runId ?? s.runId, rows: settleLeftovers(s.rows, a.reason), phase: "done" };
    case "resume":
      return { ...initialRun(), phase: "scanning", rows: pending(a.repos), runId: a.runId, reattached: true,
        plan: a.plan, consent: a.consent };
    case "reattachRows": {
      // Never overwrite a settled row: the poll's job states are coarser than anything already shown.
      const rows = { ...s.rows };
      for (const row of a.rows) {
        const cur = rows[row.repo];
        if (!cur || !rowSettled(cur)) rows[row.repo] = row;
      }
      return { ...s, rows };
    }
    case "reattachSettled":
      return { ...s, rows: settleLeftovers(s.rows, "not_scanned"), phase: "done" };
  }
}

// ── The snapshot codec ─────────────────────────────────────────────────────────────────────────────

const PHASES: readonly Phase[] = ["pick", "select", "scanning", "done"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function decodePlan(v: unknown): RunPlan | null {
  if (!isObj(v)) return null;
  const { mock, watch, schedule, upgradeAfter, publicFunnel, previewCause } = v;
  if (typeof mock !== "boolean" || typeof watch !== "boolean" || typeof upgradeAfter !== "boolean") return null;
  if (schedule !== undefined && schedule !== "off" && schedule !== "weekly") return null;
  const cause = previewCause === "credit_unknown" ? "credit_unknown" : null;
  return { mock, watch, schedule, upgradeAfter, publicFunnel: publicFunnel === true, previewCause: cause };
}

function decodeConsent(v: unknown): RunConsent | null {
  if (!isObj(v) || typeof v.previewFirst !== "boolean" || typeof v.watchOptIn !== "boolean") return null;
  return { previewFirst: v.previewFirst, watchOptIn: v.watchOptIn };
}

export function encodeSnapshot(snap: Omit<ResumeSnapshot, "version">): string {
  return JSON.stringify({ ...snap, version: 2 });
}

/** Read a stored snapshot (v1 or v2). Malformed input is no snapshot; a malformed plan is no plan. */
export function decodeSnapshot(raw: string | null): ResumeSnapshot | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || typeof v.sourceLabel !== "string" || !v.sourceLabel) return null;
  return {
    ...(v.version === 2 ? { version: 2 as const } : {}),
    org: typeof v.org === "string" ? v.org : "",
    sourceLabel: v.sourceLabel,
    sourceInstallId: typeof v.sourceInstallId === "string" ? v.sourceInstallId : null,
    selected: Array.isArray(v.selected) ? v.selected.filter((s): s is string => typeof s === "string") : [],
    phase: PHASES.includes(v.phase as Phase) ? (v.phase as Phase) : undefined,
    runId: typeof v.runId === "string" ? v.runId : null,
    plan: decodePlan(v.plan),
    consent: decodeConsent(v.consent),
  };
}
