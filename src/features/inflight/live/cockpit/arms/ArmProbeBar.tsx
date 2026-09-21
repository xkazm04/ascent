"use client";

// THE BLOCKING STATE, DRAWN — idle · probing · armable · blocked, with the remedy on screen.
//
// WHY A BLOCK AND NOT A WARNING. A comparison run costs hours of wall clock, and the two failures
// measured on this machine on 2026-09-21 both produce a RESULT rather than an error: a server left at
// its default context truncates the tool definitions, so the model looks unable to call tools; and an
// old server re-prefills the whole prompt every turn, so the arm looks slow. Either one is a
// confidently wrong verdict about a model, and a warning in an unattended overnight drive is a
// warning nobody reads.
//
// So the failure is rendered as the operator's next ACTION — "context is 4096, set
// OLLAMA_CONTEXT_LENGTH to 65536" — because a red light they cannot act on is a red light they will
// route around.

import type { ProbeResult } from "@/lib/local/transport/probe";
import { failedFindings, findingSentence } from "./armProbe";
import type { ArmProbePhase } from "./useArmProbe";

const TONE: Record<ArmProbePhase, string> = {
  idle: "text-slate-500",
  probing: "text-slate-400",
  armable: "text-success-soft",
  blocked: "text-danger",
};

const WORD: Record<ArmProbePhase, string> = {
  idle: "Not checked",
  probing: "Checking…",
  armable: "Ready to arm",
  blocked: "Blocked",
};

export interface ArmProbeBarProps {
  phase: ArmProbePhase;
  results: readonly ProbeResult[];
  error: string | null;
  /** True when the arms changed since the results were measured — a green light about another setup. */
  stale: boolean;
  onProbe: () => void;
  /** No transport to probe yet (an incomplete row), so the button has nothing to do. */
  disabled: boolean;
}

export function ArmProbeBar({ phase, results, error, stale, onProbe, disabled }: ArmProbeBarProps) {
  const shown: ArmProbePhase = stale && phase !== "probing" ? "idle" : phase;
  const failures = shown === "blocked" ? failedFindings(results) : [];
  return (
    <div className="rounded-lg border border-divider bg-surface/40 p-3" data-testid="arm-probe" data-state={shown}>
      <div className="flex items-center justify-between gap-3">
        <span className={`type-caption ${TONE[shown]}`} data-testid="arm-probe-state">
          {WORD[shown]}
        </span>
        <button
          type="button"
          onClick={onProbe}
          disabled={disabled || phase === "probing"}
          data-testid="arm-probe-run"
          className="focus-ring shrink-0 rounded-lg border border-divider px-2.5 py-1 type-body-sm text-slate-300 transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          Check transports
        </button>
      </div>
      <p className="mt-1.5 type-note leading-relaxed text-slate-500">
        Proves each transport is installed, authorized and pointed at a server that will answer honestly — through the
        same spawn door the run will use, without spending tokens. A run cannot be armed until it passes.
      </p>
      {shown === "blocked" && (
        <div role="alert" className="mt-2 space-y-1.5">
          {error && <p className="type-note leading-relaxed text-danger">{error}</p>}
          {failures.map(({ transport, finding }) => (
            <p key={`${transport}-${finding.check}`} className="type-note leading-relaxed text-slate-300">
              <span className="text-danger">
                {transport} · {finding.check}
              </span>{" "}
              — {findingSentence(finding)}
            </p>
          ))}
        </div>
      )}
      {shown === "armable" && results.some((r) => !r.zeroToken) && (
        <p className="mt-2 type-note text-slate-500">This probe was not free — one of the transports spent tokens.</p>
      )}
    </div>
  );
}
