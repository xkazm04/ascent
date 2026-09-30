"use client";

// Reflect, Prism. Propose writes nothing. Apply is a second click and supersedes, never deletes.
// No engine is not measured: the proposals step does not show a zero.
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Caption, Frame, GhostAction, Ladder, PrimaryAction, SectionHead } from "@/components/kit";
import { MemoryReflectProposalV2 } from "./MemoryReflectProposal.v2";
import { reflectOutcomeCopy, runReflectApply, runReflectPropose, type ReflectProposal, type ReflectResponse } from "./memoryReflect";
import { reflectLadder } from "./memoryView";
import { MemoryNote } from "./MemoryNote";

export function MemoryReflectV2({ slug, canWrite }: { slug: string; canWrite: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [result, setResult] = useState<ReflectResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applied, setApplied] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

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
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : "The reflection pass failed.");
    } finally {
      if (abort.current === ac) {
        abort.current = null;
        setRunning(false);
      }
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
        `Summary written. ${res.superseded} memor${res.superseded === 1 ? "y" : "ies"} now point to it, staying in the store, linked to the rollup that replaced them.`,
      );
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to write the summary.");
    } finally {
      setApplyingId(null);
    }
  }

  const outcome = result ? reflectOutcomeCopy(result) : null;
  const action = canWrite ? (
    running ? (
      <GhostAction onClick={() => abort.current?.abort()}>Reflecting… cancel</GhostAction>
    ) : (
      <PrimaryAction onClick={() => void propose()}>Propose consolidation</PrimaryAction>
    )
  ) : null;

  return (
    <Frame aria-label="Reflect">
      <SectionHead
        eyebrow="Reflect"
        title="Roll up"
        named="what repeats"
        lede="Memory grows by accretion. Reflect clusters notes that restate one subject and asks the model for a single summary. Applying is a separate step."
        actions={action}
      />
      {!canWrite && (
        <p className="mt-4 type-body-sm text-slate-400">
          Reflection spends a model call and can supersede memories, so it follows the same entitlement as writing: a member on a Team plan, or your personal workspace.
        </p>
      )}
      {result && (
        <div className="mt-5">
          <Ladder
            label="Reflection pass"
            steps={reflectLadder({
              consideredCount: result.consideredCount,
              clusterCount: result.clusterCount,
              proposalCount: result.proposals.length,
              llmUnavailable: result.llmUnavailable,
            })}
          />
          <Caption className="mt-2">{result.llmUnavailable ? "No model engine." : `Judged by ${result.engine}.`}</Caption>
        </div>
      )}
      {outcome && (
        <div className="mt-4">
          <p className="type-body-sm font-medium text-white">{outcome.headline}</p>
          <p className="mt-1 type-body-sm text-slate-400">{outcome.detail}</p>
        </div>
      )}
      {result && result.proposals.length > 0 && (
        <div className="mt-4 space-y-3">
          {result.proposals.map((p) => {
            const key = p.memberIds[0]!;
            return (
              <MemoryReflectProposalV2
                key={key}
                proposal={p}
                applied={applied.includes(key)}
                applying={applyingId === key}
                onApply={() => void apply(p)}
              />
            );
          })}
        </div>
      )}
      {notice && <MemoryNote kind="good">{notice}</MemoryNote>}
      {error && <MemoryNote kind="risk">{error}</MemoryNote>}
    </Frame>
  );
}
