"use client";

// The conversation's state: one boot read, then one exchange at a time.
//
// BOOT IS LAZY BY MOUNT. This hook fetches the moment it mounts and the drawer only mounts it when a
// member actually switches to Athena — so a dashboard nobody asks her about costs one request fewer
// than it did before. Once mounted it STAYS mounted (the drawer hides it with CSS rather than
// unmounting), which is what makes a conversation survive both a channel switch and a tab switch.
//
// THE QUESTION IS SHOWN OPTIMISTICALLY. The server persists the user turn before any spend but never
// echoes it back as an event, so the transcript adds it locally. Its `id` is a `local:` marker, never
// an empty string — `turn.id === ""` already means something specific (persisted nowhere).
//
// A FAILED TURN KEEPS THE QUESTION ON SCREEN. Removing it on error would leave a conversation that
// silently forgot the operator said anything; leaving it beside the reason is a legible failure.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AthenaPhase } from "@/lib/athena/turn";
import type { AthenaTurnRecord } from "@/lib/db/athena-threads";
import type { AthenaProposalRecord } from "@/lib/db/athena-proposals";
import type { AthenaBoot } from "./model";
import { createAthenaThread, fetchAthenaBoot, streamAthenaMessage } from "./stream";

export interface AthenaThreadState {
  loading: boolean;
  turns: AthenaTurnRecord[];
  proposals: AthenaProposalRecord[];
  /** No engine is configured for this org — she still answers, in one quiet line. */
  degraded: boolean;
  phase: AthenaPhase | null;
  /** The tool she is calling right now, by name. Null between calls. */
  tool: string | null;
  /** Chips for the turn IN FLIGHT (the settled record carries its own). */
  liveChips: string[];
  sending: boolean;
  /** When the current wait began, for the honest second line. Null when not waiting. */
  waitingSince: number | null;
  error: string | null;
  send: (message: string) => void;
}

const localTurn = (n: number, content: string): AthenaTurnRecord => ({
  id: `local:${n}`,
  threadId: "",
  role: "user",
  content,
  meta: {},
  inputTokens: null,
  outputTokens: null,
  legs: null,
  createdAt: new Date().toISOString(),
});

export function useAthenaThread(org: string): AthenaThreadState {
  const [loading, setLoading] = useState(true);
  const [turns, setTurns] = useState<AthenaTurnRecord[]>([]);
  const [proposals, setProposals] = useState<AthenaProposalRecord[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [phase, setPhase] = useState<AthenaPhase | null>(null);
  const [tool, setTool] = useState<string | null>(null);
  const [liveChips, setLiveChips] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const threadId = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    abort.current = controller;
    (async () => {
      try {
        const boot = (await fetchAthenaBoot(org, controller.signal)) as AthenaBoot;
        if (!alive.current) return;
        threadId.current = boot.thread?.id ?? null;
        setTurns(Array.isArray(boot.turns) ? boot.turns : []);
        setProposals(Array.isArray(boot.proposals) ? boot.proposals : []);
        setDegraded(boot.degraded === true);
      } catch (err) {
        // A failed boot is not a dead panel: the composer stays usable and the first send will make
        // its own thread. Only a refusal is worth saying out loud.
        if (alive.current && !controller.signal.aborted) {
          setError(err instanceof Error && err.message.length > 3 ? err.message : null);
        }
      } finally {
        if (alive.current) setLoading(false);
      }
    })();
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [org]);

  const send = useCallback(
    (raw: string) => {
      const message = raw.trim();
      if (!message || sending) return;
      const controller = new AbortController();
      abort.current = controller;
      setError(null);
      setLiveChips([]);
      setTool(null);
      setSending(true);
      setWaitingSince(Date.now());
      setPhase("recalling");
      setTurns((t) => [...t, localTurn(++seq.current, message)]);

      void (async () => {
        try {
          if (!threadId.current) threadId.current = await createAthenaThread(org, controller.signal);
          if (!threadId.current) {
            if (alive.current) setError("Couldn't start a conversation.");
            return;
          }
          await streamAthenaMessage({
            org,
            threadId: threadId.current,
            message,
            signal: controller.signal,
            onEvent: (event) => {
              if (!alive.current) return;
              if (event.type === "phase") setPhase(event.phase);
              else if (event.type === "recall") setLiveChips(event.chips.map((c) => c.insight));
              else if (event.type === "tool") setTool(event.name);
              else if (event.type === "settled") setTurns((t) => [...t, event.turn]);
              else setError(event.message);
            },
          });
        } catch {
          if (alive.current && !controller.signal.aborted) setError("The turn failed.");
        } finally {
          if (alive.current) {
            setSending(false);
            setPhase(null);
            setTool(null);
            setWaitingSince(null);
          }
        }
      })();
    },
    [org, sending],
  );

  return { loading, turns, proposals, degraded, phase, tool, liveChips, sending, waitingSince, error, send };
}
