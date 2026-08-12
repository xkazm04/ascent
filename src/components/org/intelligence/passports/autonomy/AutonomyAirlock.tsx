"use client";

// VARIANT B — "Airlock".
//
// Metaphor: a PRESSURISED CORRIDOR. Autonomy is not a grade you hold, it's a room you're standing
// in — and the interesting object is the DOOR, not the repo. Four chambers T0…T3, three sealed
// doors between them, every scanned repo a token in the chamber it has actually reached. A door is
// labelled with the gates that seal it and how many repos are queued behind it; clicking it opens
// the queue with the exact unlock action per repo. Differs from the baseline (two continuous score
// axes on a scatter) by being discrete and spatial: the fleet's bottleneck is a physical door you
// can point at, and "what unblocks the next tier" is the door's own label.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Kicker, Surface } from "@/components/ui";
import { Meter, SectionEmpty } from "@/components/org/shared/ui";
import { reportPermalink, scoreHex } from "@/lib/ui";
import {
  GATE_ORDER,
  TIER_META,
  tierHex,
  type AutonomyTier,
  type RepoAutonomy,
} from "./autonomyModel";
import { AirlockCorridor, type DoorState } from "./AirlockCorridor";
import { AutonomyPreamble, GateDot, SourcePin } from "./autonomyShared";

export function AutonomyAirlock({ repos }: { repos: RepoAutonomy[] }) {
  const [door, setDoor] = useState<AutonomyTier | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const doors: DoorState[] = useMemo(
    () =>
      ([1, 2, 3] as AutonomyTier[]).map((into) => {
        const queued = repos.filter((r) => r.tier === into - 1).sort((a, b) => b.nextProgress - a.nextProgress);
        // Every repo carries the same five gates, so the first one is a valid template for labels.
        const template = repos[0];
        const gateShorts = template
          ? GATE_ORDER.map((id) => template.gates.find((g) => g.id === id))
              .filter((g) => g != null && g.gatesTier === into)
              .map((g) => g!.short)
          : [];
        return {
          into,
          gateShorts,
          queued,
          pressure: queued.length ? Math.round(queued.reduce((s, r) => s + r.nextProgress, 0) / queued.length) : 100,
        };
      }),
    [repos],
  );

  const openDoor = door != null ? doors.find((d) => d.into === door) ?? null : null;
  const focused = focus ? repos.find((r) => r.fullName === focus) ?? null : null;

  if (repos.length === 0) {
    return <SectionEmpty>No passports in this scope yet — the corridor is empty until a repo is scanned.</SectionEmpty>;
  }

  return (
    <div className="space-y-6">
      <AutonomyPreamble
        kicker="Autonomy airlock"
        title="Which door is your fleet stuck behind?"
        intro="Each repo stands in the highest chamber its scan signals let it hold. The doors between chambers are the gates — a sealed door shows the queue behind it, so the fleet's real bottleneck is one thing you can point at."
      />

      <Surface tone="strong" className="p-4">
        <AirlockCorridor repos={repos} doors={doors} active={door} onDoor={(t) => setDoor((cur) => (cur === t ? null : t))} onRepo={(f) => setFocus((c) => (c === f ? null : f))} focused={focus} />
      </Surface>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Door dossier — the fleet-level unlock. */}
        <Surface className="p-5">
          {openDoor ? (
            <>
              <Kicker>
                Door into {TIER_META[openDoor.into].code} · {TIER_META[openDoor.into].label}
              </Kicker>
              <p className="mt-2 text-base text-slate-200">{TIER_META[openDoor.into].blurb}</p>
              {openDoor.queued.length === 0 ? (
                <p className="mt-4 text-sm text-slate-400">Nothing queued here — no repo is one step below this door.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {openDoor.queued.slice(0, 8).map((r) => (
                    <li key={r.fullName} className="border-b border-divider pb-3 last:border-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <Link href={reportPermalink(r.fullName)} className="font-mono text-sm text-white hover:text-accent">
                          {r.name}
                        </Link>
                        <span className="font-mono text-xs tabular-nums" style={{ color: scoreHex(r.nextProgress) }}>
                          {r.nextProgress}%
                        </span>
                      </div>
                      <Meter value={r.nextProgress} color={scoreHex(r.nextProgress)} size="sm" className="mt-1.5" ariaLabel={`${r.name} pressure toward ${TIER_META[openDoor.into].code}`} />
                      <p className="mt-1.5 text-sm text-slate-300">{r.blocking[0]?.action ?? "Conditions met — cycle the door."}</p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <Kicker tone="muted">Doors</Kicker>
              <p className="mt-2 text-base text-slate-300">Select a door in the corridor to see its queue and the one action that cycles it.</p>
              <ul className="mt-4 space-y-2">
                {doors.map((d) => (
                  <li key={d.into} className="flex items-center justify-between gap-3 text-sm">
                    <button type="button" onClick={() => setDoor(d.into)} className="focus-ring text-left text-slate-200 transition hover:text-accent">
                      <span className="font-mono" style={{ color: tierHex(d.into) }}>{TIER_META[d.into].code}</span> — sealed by{" "}
                      <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-400">{d.gateShorts.join(" + ")}</span>
                    </button>
                    <span className="font-mono text-xs tabular-nums text-slate-400">{d.queued.length} queued</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Surface>

        {/* Repo dossier — the per-repo unlock, on demand. */}
        <Surface className="p-5">
          {focused ? (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <Link href={reportPermalink(focused.fullName)} className="font-mono text-base text-white hover:text-accent">
                  {focused.name}
                </Link>
                <span className="font-mono text-sm" style={{ color: tierHex(focused.tier) }}>
                  {TIER_META[focused.tier].code}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-400">{focused.purpose || "No stated purpose."}</p>
              <ul className="mt-4 space-y-2">
                {focused.gates.map((g) => (
                  <li key={g.id} className="text-sm">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <GateDot score={g.score} status={g.status} />
                      <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-400">{g.short}</span>
                      <SourcePin source={g.source} />
                      <span className="font-mono text-xs tabular-nums" style={{ color: scoreHex(g.score) }}>{g.score}</span>
                    </span>
                    <span className="block pl-5 text-slate-400">{g.evidence}</span>
                  </li>
                ))}
              </ul>
              {focused.stack.length > 0 && (
                <p className="mt-4 font-mono text-xs uppercase tracking-[0.18em] text-slate-500">{focused.stack.join(" · ")}</p>
              )}
            </>
          ) : (
            <>
              <Kicker tone="muted">Repo</Kicker>
              <p className="mt-2 text-base text-slate-300">Click a token in a chamber to read that repo&apos;s five gate conditions and the evidence behind each.</p>
            </>
          )}
        </Surface>
      </div>
    </div>
  );
}
