"use client";

// The claim verbs on one expanded ledger row: take over, send back, release. Only the verbs the pure
// table admits for this viewer are drawn (claimActionsModel.ts), and the route re-checks every one. A
// row nobody holds draws nothing, which is the ordinary open row.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { claimActionsFor, postClaimVerb, type ClaimState, type ClaimVerb, type ClaimViewer } from "./claimActionsModel";

const VERB_COPY: Record<ClaimVerb, { label: string; title: string; cls: string }> = {
  "take-over": {
    label: "take over",
    title: "Hold this yourself: the escalation clears and the row stays in progress, claimed by you",
    cls: "hover:text-accent",
  },
  "send-back": {
    label: "send back",
    title: "Return this to the queue for the next worker: the claim is cleared",
    cls: "hover:text-warn",
  },
  release: {
    label: "release",
    title: "Give this hand-off back to the queue: the claim is cleared",
    cls: "hover:text-slate-300",
  },
};

export function ClaimRowActions({ org, r, viewer }: { org: string; r: ClaimState & { id: string }; viewer: ClaimViewer }) {
  const router = useRouter();
  const [busy, setBusy] = useState<ClaimVerb | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Computed at render: the table reads the lease as of this paint; the route answers for the write.
  const verbs = claimActionsFor(r, viewer);
  if (verbs.length === 0) return null;

  const act = async (verb: ClaimVerb) => {
    setBusy(verb);
    setError(null);
    try {
      await postClaimVerb(org, verb, [r.id]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the claim.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="inline-flex items-center gap-3 type-caption">
      {verbs.map((verb) => (
        <button
          key={verb}
          type="button"
          onClick={() => void act(verb)}
          disabled={busy !== null}
          className={`focus-ring rounded text-slate-500 ${VERB_COPY[verb].cls}`}
          title={VERB_COPY[verb].title}
        >
          {busy === verb ? "…" : VERB_COPY[verb].label}
        </button>
      ))}
      {error && <span className="text-danger">{error}</span>}
    </span>
  );
}
