"use client";

// ATHENA, INSIDE THE DRAWER. Not a floating bubble, not a second panel: the drawer is the product's
// one right-edge guidance channel and she is a posture of it. Adding a launcher of her own would have
// made her the second one — and this repo already refuses the equivalent for feedback ("never a toast
// that scrolls away from the control that caused it", useRegistryMutation.ts:9).
//
// SHE IS THE CHECKLIST'S VOICE, NOT A SECOND OPINION. `restingLine` is handed the step the checklist
// already promoted; nothing here re-derives doneness. `buildGettingStartedModel` stays the only thing
// in the product that decides what is left to do.
//
// ANNOUNCEMENTS ARE AT THE LEVEL OF "A DECISION IS WAITING", never per beat. The phase strip is
// `aria-hidden` (see AthenaWaiting) and this one polite region says a single thing per settled turn.
// Three announcements per answer is how a helpful surface becomes one a screen-reader user turns off.

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { Kicker } from "@/components/ui";
import type { AthenaProposalRecord } from "@/lib/db/athena-proposals";
import { AthenaComposer } from "./AthenaComposer";
import { AthenaTurnView } from "./AthenaTurnView";
import { AthenaWaiting } from "./AthenaWaiting";
import { restingLine, type AthenaNextStep } from "./restingLine";
import { useAthenaThread } from "./useAthenaThread";

export function AthenaPanel({
  slug,
  next,
  degradedHref,
}: {
  slug: string;
  /** The step the CHECKLIST promoted, or null. Read, never re-derived. */
  next: AthenaNextStep | null;
  /** Where the model provider is configured — a limitation with no stated remedy reads as a defect. */
  degradedHref: string;
}) {
  const s = useAthenaThread(slug);
  const scroller = useRef<HTMLDivElement | null>(null);

  // A new turn belongs at the bottom of the view, not wherever the last one left the scroll position.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.turns.length, s.sending]);

  const { proposals } = s;
  const byTurn = useMemo(() => {
    const map = new Map<string, AthenaProposalRecord[]>();
    for (const p of proposals) map.set(p.turnId, [...(map.get(p.turnId) ?? []), p]);
    return map;
  }, [proposals]);

  const last = s.turns[s.turns.length - 1];
  const openAsks = proposals.length;
  // The error already lives in a `role="alert"` below; naming it here too would announce it twice.
  const announcement =
    openAsks > 0
      ? `Athena answered, and ${openAsks === 1 ? "one decision is" : `${openAsks} decisions are`} waiting on you.`
      : last?.role === "assistant"
        ? "Athena answered."
        : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {s.degraded && (
        <p className="border-b border-divider px-4 py-2 text-xs leading-relaxed text-slate-500">
          No model is configured for this organization, so I can only answer from what is already stored
          here.{" "}
          <Link href={degradedHref} className="focus-ring text-accent underline-offset-2 hover:underline">
            An owner connects one in Settings
          </Link>
          .
        </p>
      )}

      <div ref={scroller} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-3">
        {s.turns.length === 0 && !s.loading && (
          <div className="border-l-2 border-accent/50 pl-3">
            <Kicker>Athena</Kicker>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">{restingLine(next)}</p>
            {next && (
              <Link
                href={next.href}
                className="focus-ring mt-2 inline-block rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-accent hover:text-white"
              >
                {next.cta}
              </Link>
            )}
          </div>
        )}

        {s.turns.map((turn) => (
          <AthenaTurnView key={turn.id} turn={turn} proposals={byTurn.get(turn.id) ?? []} />
        ))}

        <AthenaWaiting phase={s.phase} tool={s.tool} since={s.waitingSince} />

        {s.error && (
          <p role="alert" className="border-l-2 border-danger/60 pl-3 text-sm leading-relaxed text-slate-400">
            {s.error}
          </p>
        )}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <AthenaComposer onSend={s.send} sending={s.sending} />
    </div>
  );
}
