"use client";

// THE PROBE'S STATE MACHINE — idle → probing → armable | blocked, and nothing else.
//
// NO EFFECT RUNS THIS. The probe spawns a real subprocess on the server, so it fires from a deliberate
// press and from nowhere else; and an effect that re-probed on every keystroke in a model field would
// be both expensive and, under this repo's React Compiler rules, an error
// (`react-hooks/set-state-in-effect`).
//
// STALENESS IS COMPUTED, NOT SIGNALLED. The hook records the transport signature it probed. A caller
// compares that with the signature its current arms carry and knows, during render and with no state
// at all, whether the green light still refers to the configuration on screen.

import { useState } from "react";
import type { TransportId } from "@/lib/local/arm";
import type { ProbeResult } from "@/lib/local/transport/probe";
import { allOk, probeTransportOverHttp } from "./armProbe";

export type ArmProbePhase = "idle" | "probing" | "armable" | "blocked";

export interface ArmProbeState {
  phase: ArmProbePhase;
  results: ProbeResult[];
  /** The route's own refusal sentence, or the transport failure, verbatim. */
  error: string | null;
  /** The configuration the current `results` were measured against — see `armsSignature`. */
  signature: string;
  run: (transports: readonly TransportId[], signature: string) => Promise<ArmProbePhase>;
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
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState("");

  const run = async (transports: readonly TransportId[], sig: string): Promise<ArmProbePhase> => {
    const slug = currentOrgSlug();
    if (!slug || transports.length === 0) return phase;
    setPhase("probing");
    setError(null);
    try {
      const replies = await Promise.all(transports.map((t) => probeTransportOverHttp(slug, t)));
      const next = replies.map((r) => r.probe);
      const settled: ArmProbePhase = allOk(next) ? "armable" : "blocked";
      // The route computes the one-sentence refusal itself (`probeRefusal`); it leads the alert, and
      // the per-finding remedies follow it. Never re-derived here — that would be a second list.
      const refusal = replies.map((r) => r.refusal).filter((r): r is string => !!r).join(" ");
      setError(refusal || null);
      setResults(next);
      setSignature(sig);
      setPhase(settled);
      return settled;
    } catch (e) {
      // An unreachable route is a BLOCK, not a shrug: nothing has proven the transport can answer, and
      // arming on an unproven transport is exactly the hours-long wrong answer the probe exists to stop.
      setResults([]);
      setSignature(sig);
      setError(e instanceof Error ? e.message : "The probe could not be reached.");
      setPhase("blocked");
      return "blocked";
    }
  };

  return { phase, results, error, signature, run };
}
