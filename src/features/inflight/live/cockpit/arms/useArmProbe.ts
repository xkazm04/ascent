"use client";

// THE PROBE'S STATE MACHINE — idle → probing → armable | blocked, and nothing else.
//
// NO EFFECT RUNS THIS. The probe spawns a real subprocess on the server, so it fires from a deliberate
// press and from nowhere else; and an effect that re-probed on every keystroke in a model field would
// be both expensive and, under this repo's React Compiler rules, an error
// (`react-hooks/set-state-in-effect`).
//
// STALENESS IS COMPUTED, NOT SIGNALLED. The hook records the signature of the whole configuration it
// probed. A caller compares that with the signature its current arms carry and knows, during render
// and with no state at all, whether the green light still refers to the configuration on screen.

import { useState } from "react";
import type { ArmPolicy } from "@/lib/local/arm";
import { allArmsOk, probeArmsOverHttp, type ArmProbeReply } from "./armProbe";

export type ArmProbePhase = "idle" | "probing" | "armable" | "blocked";

export interface ArmProbeState {
  phase: ArmProbePhase;
  /** The per-arm verdicts and the probes they rest on, or null when nothing has been measured. */
  reply: ArmProbeReply | null;
  /** The route's own refusal sentence, or the transport failure, verbatim. */
  error: string | null;
  /** The configuration the current `reply` was measured against — see `armsSignature`. */
  signature: string;
  run: (arms: readonly Record<string, unknown>[], policy: ArmPolicy, signature: string) => Promise<ArmProbePhase>;
}

/**
 * `/org/<slug>?tab=live` — the cockpit's own address.
 *
 * Read from `location` at PRESS TIME rather than through `usePathname`, and deliberately: the panel
 * sits three components below the dialog and none of them is this package's to change, so threading
 * an `org` prop is not available; and a `usePathname` call would force every existing test that
 * renders the dialog to extend its `next/navigation` mock — a file outside this package's scope.
 * A handler-time read needs no hook, no mock and no provider.
 */
export function orgSlugFromPath(pathname: string | null): string | null {
  const m = /^\/org\/([^/?#]+)/.exec(pathname ?? "");
  const raw = m?.[1];
  return raw ? decodeURIComponent(raw) : null;
}

const currentOrgSlug = (): string | null =>
  typeof window === "undefined" ? null : orgSlugFromPath(window.location.pathname);

export function useArmProbe(): ArmProbeState {
  const [phase, setPhase] = useState<ArmProbePhase>("idle");
  const [reply, setReply] = useState<ArmProbeReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState("");

  const run = async (
    arms: readonly Record<string, unknown>[],
    policy: ArmPolicy,
    sig: string,
  ): Promise<ArmProbePhase> => {
    const slug = currentOrgSlug();
    if (!slug || arms.length === 0) return phase;
    setPhase("probing");
    setError(null);
    try {
      const next = await probeArmsOverHttp(slug, arms, policy);
      const settled: ArmProbePhase = allArmsOk(next) ? "armable" : "blocked";
      // The route computes the refusal sentences itself (`probeRefusal`, one per blocked arm); they
      // lead the alert and the per-finding remedies follow. Never re-derived here — a second list.
      setError(next.refusal);
      setReply(next);
      setSignature(sig);
      setPhase(settled);
      return settled;
    } catch (e) {
      // An unreachable route is a BLOCK, not a shrug: nothing has proven the arms can run, and arming
      // on an unproven arm is exactly the hours-long wrong answer the probe exists to stop.
      setReply(null);
      setSignature(sig);
      setError(e instanceof Error ? e.message : "The probe could not be reached.");
      setPhase("blocked");
      return "blocked";
    }
  };

  return { phase, reply, error, signature, run };
}
