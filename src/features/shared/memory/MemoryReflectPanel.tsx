"use client";

// The UI entry point for the `reflect` verb — the pass that produces the `summary` memory kind. It was
// fully built, tested and routed, and reachable from nothing: no component in the app called it, and in
// production it could not have worked anyway (the only engine was the local CLI).
//
// TWO PROPERTIES THIS COMPONENT EXISTS TO PRESERVE:
//
//  1. NOTHING IS APPLIED IMPLICITLY. Proposing is one deliberate click and applying is a second one, per
//     proposal, with the memories that would be superseded listed underneath. A rollup retires memories
//     real people wrote; a model that misreads a family must never be able to do that unattended.
//  2. AN EMPTY RESULT IS EXPLAINED, NEVER JUST BLANK. "No engine available", "nothing to consolidate"
//     and "the model declined to roll these up" are three different facts (see reflectOutcomeCopy) and
//     they ask three different things of the reader.
//
// Gated exactly as the route gates: a member on a Team+ plan or in a personal workspace. Read-only
// viewers see the explanation and no button, rather than a control that 403s.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { MemoryReflectProposal } from "@/features/shared/memory/MemoryReflectProposal";
import {
  reflectOutcomeCopy,
  runReflectApply,
  runReflectPropose,
  type ReflectProposal,
  type ReflectResponse,
} from "@/features/shared/memory/memoryReflect";

export function MemoryReflectPanel({ slug, canWrite }: { slug: string; canWrite: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [result, setResult] = useState<ReflectResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applied, setApplied] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // A propose outlives the click that started it; abort on unmount so the model call is cancelled.
  useEffect(() => () => abort.current?.abort(), []);

  async function propose() {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    setError(null);
    setNotice(null);
    setResult(null);
    setApplied([]);
    try {
      setResult(await runReflectPropose({ org: slug }, ac.signal));
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : "The reflection pass failed.");
      }
    } finally {
      if (abort.current === ac) abort.current = null;
      setRunning(false);
    }
  }

  async function apply(proposal: ReflectProposal) {
    const key = proposal.memberIds[0]!;
    setApplyingId(key);
    setError(null);
    try {
      const res = await runReflectApply({ org: slug, proposal });
      setApplied((a) => [...a, key]);
      setNotice(
        `Summary written. ${res.superseded} memor${res.superseded === 1 ? "y" : "ies"} now point to it, ` +
          "staying in the store, linked to the rollup that replaced them.",
      );
      // The rollup and its now-superseded members both change the server-rendered list above.
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to write the summary.");
    } finally {
      setApplyingId(null);
    }
  }

  const outcome = result ? reflectOutcomeCopy(result) : null;

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Reflect: roll up what repeats"
        description="Memory grows by accretion: six notes about one incident are six recall-budget entries that together say one thing. Reflect clusters what restates the same subject and asks the model for a single summary. Nothing is written until you apply a proposal, and applying supersedes the members rather than deleting them."
        right={
          canWrite ? (
            <button
              onClick={running ? () => abort.current?.abort() : propose}
              className={
                running
                  ? "rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:border-orange-400/60 hover:text-orange-300"
                  : "rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent/20"
              }
              title={
                running
                  ? "Stop the running pass"
                  : "One model pass over at most 4 candidate families. Proposes only, writes nothing."
              }
            >
              {running ? "Reflecting… cancel" : "Propose consolidation"}
            </button>
          ) : null
        }
      />

      {!canWrite && (
        <p className="mt-3 text-sm text-slate-500">
          Reflection spends a model call and can supersede memories, so it follows the same entitlement as
          writing: a member on a Team plan, or your personal workspace.
        </p>
      )}

      {result && (
        <p className="mt-3 font-mono text-xs text-slate-500">
          considered {result.consideredCount} active memor{result.consideredCount === 1 ? "y" : "ies"} ·{" "}
          {result.clusterCount} candidate famil{result.clusterCount === 1 ? "y" : "ies"} ·{" "}
          {result.llmUnavailable ? "no model engine" : `judged by ${result.engine}`}
        </p>
      )}

      {outcome && (
        <div className="mt-2 rounded-xl border border-slate-700 bg-slate-950/40 p-3">
          <p className="text-sm font-medium text-slate-200">{outcome.headline}</p>
          <p className="mt-1 text-sm text-slate-500">{outcome.detail}</p>
        </div>
      )}

      {result && result.proposals.length > 0 && (
        <div className="mt-3 space-y-3">
          {result.proposals.map((p) => {
            const key = p.memberIds[0]!;
            return (
              <MemoryReflectProposal
                key={key}
                proposal={p}
                applied={applied.includes(key)}
                applying={applyingId === key}
                onApply={() => apply(p)}
              />
            );
          })}
        </div>
      )}

      {notice && <p className="mt-2 text-sm text-emerald-300">{notice}</p>}
      {error && <p className="mt-2 text-sm text-orange-300">{error}</p>}
    </Card>
  );
}
