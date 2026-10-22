"use client";

// The offers, and this tab's answers to them.
//
// THE LIST IS A VIEW OF STATE, NOT A QUEUE OF BUTTONS. It is seeded by the boot read and RE-READ from
// the same boot route whenever this tab learns its copy is stale: a 409 (someone answered it
// elsewhere), a 404, a dead socket (the answer may have landed), and a settled turn that says it raised
// offers (`meta.proposalIds`) - which is how a card offered mid-conversation appears without a reload.
//
// ONE CLICK, ONE REQUEST. The in-flight set is a ref, not state, so two clicks inside one render (a
// double click) cannot both pass the guard before React has re-rendered the buttons as disabled.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AthenaBoot, AthenaProposalWire } from "./model";
import { needsRefresh, proposalIdsOf, type AthenaDecision, type LocalCard } from "./proposalModel";
import { fetchAthenaBoot, resolveAthenaProposal } from "./stream";

export interface AthenaProposalsState {
  proposals: AthenaProposalWire[];
  /** This tab's last answer per proposal id. Absent = nothing asked from here. */
  local: Record<string, LocalCard>;
  decide: (id: string, decision: AthenaDecision) => void;
}

export interface AthenaProposalsControl extends AthenaProposalsState {
  seed: (list: unknown) => void;
  afterSettled: (turn: { meta?: Record<string, unknown> }) => void;
}

const asList = (v: unknown): AthenaProposalWire[] => (Array.isArray(v) ? (v as AthenaProposalWire[]) : []);

export function useAthenaProposals(org: string): AthenaProposalsControl {
  const [proposals, setProposals] = useState<AthenaProposalWire[]>([]);
  const [local, setLocal] = useState<Record<string, LocalCard>>({});
  const inflight = useRef(new Set<string>());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const seed = useCallback((list: unknown) => setProposals(asList(list)), []);

  const refresh = useCallback(async () => {
    try {
      const boot = (await fetchAthenaBoot(org)) as AthenaBoot;
      if (alive.current) setProposals(asList(boot.proposals));
    } catch {
      // A failed re-read keeps the list it had; the card's own state already says what happened.
    }
  }, [org]);

  const afterSettled = useCallback(
    (turn: { meta?: Record<string, unknown> }) => {
      if (proposalIdsOf(turn).length > 0) void refresh();
    },
    [refresh],
  );

  const decide = useCallback(
    (id: string, decision: AthenaDecision) => {
      if (inflight.current.has(id)) return;
      inflight.current.add(id);
      setLocal((m) => ({ ...m, [id]: { phase: "submitting", decision } }));
      void (async () => {
        const result = await resolveAthenaProposal(org, id, decision);
        inflight.current.delete(id);
        if (!alive.current) return;
        setLocal((m) => ({ ...m, [id]: { phase: "settled", result } }));
        if (needsRefresh(result)) await refresh();
      })();
    },
    [org, refresh],
  );

  return { proposals, local, decide, seed, afterSettled };
}
