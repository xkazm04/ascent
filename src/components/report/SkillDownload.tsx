"use client";

// The "✦ Onboarding skill" header control. The pill itself keeps the one-click default (Ascent picks
// the weak dimensions); the adjacent "Choose tracks" affordance opens the picker that finally reaches
// the generator's long-dormant maintainer multiselect (`?dims=`), so a session can be scoped to one
// dimension — or ask for a REFINEMENT on a dimension the repo is already strong on.
//
// Index chrome: a hairline-ruled dimension ledger inside the brand Modal, mono tabular-nums scores,
// score color only ever from scoreHex. No hand-rolled overlay — Modal owns focus trap/Escape/scroll.

import { useMemo, useState } from "react";
import type { DimensionId, DimensionResult } from "@/lib/types";
import { scoreHex } from "@/lib/ui";
import { Kicker, Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui";
import { pillClass } from "@/components/report/pill";

/** Mirrors WEAK_THRESHOLD in @/lib/onboarding/tracks — the score at/above which a dimension is a
 *  strength rather than an onboarding gap. Duplicated as a display hint only (the server re-derives
 *  the real selection); it never decides what the generated skill contains. */
const WEAK_THRESHOLD = 70;

function skillHref(repoParam: string, dims?: DimensionId[]): string {
  const q = new URLSearchParams({ repo: repoParam });
  if (dims?.length) q.set("dims", dims.join(","));
  return `/api/report/skill?${q.toString()}`;
}

export function SkillDownload({
  repoParam,
  dimensions,
}: {
  /** The already-composed `owner/name[@sha]` value (unencoded). */
  repoParam: string;
  /** The report's dimensions — the pickable set. Optional so a partial/legacy report still renders
   *  the plain download pill (the picker simply has nothing to offer) instead of throwing. */
  dimensions?: DimensionResult[];
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<DimensionId[]>([]);
  const dims = useMemo(() => dimensions ?? [], [dimensions]);

  // The default set Ascent would choose on its own — shown as the "auto" marker so a maintainer can
  // see what they are overriding before they override it.
  const auto = useMemo(() => new Set(dims.filter((d) => d.score < WEAK_THRESHOLD).map((d) => d.id)), [dims]);

  const toggle = (id: DimensionId) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <>
      <a
        href={skillHref(repoParam)}
        className={pillClass({ accent: true, focusRing: true, textSm: true })}
        title="Download a personalized Claude Code onboarding skill (drop it in .claude/skills/ and run it to act on this report)"
      >
        <span aria-hidden>✦</span> Onboarding skill
      </a>
      {dims.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={pillClass({ focusRing: true, textSm: true })}
          title="Choose which dimensions the onboarding skill should cover"
        >
          Choose tracks
        </button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} ariaLabel="Choose onboarding skill tracks" size="lg">
        <ModalHeader kicker="Onboarding skill" title="Choose the tracks" context={repoParam} />
        <ModalBody className="max-h-[60vh] overflow-y-auto">
          <p className="text-sm text-slate-400">
            By default Ascent picks the dimensions this repo is weak on. Select your own set to scope a
            session — including a <span className="text-slate-200">refinement</span> on a dimension that
            is already strong.
          </p>
          <ul className="mt-4 divide-y divide-divider border-y border-divider">
            {dims.map((d) => {
              const checked = picked.includes(d.id);
              return (
                <li key={d.id}>
                  <label className="flex cursor-pointer items-center gap-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(d.id)}
                      className="focus-ring size-4 shrink-0 accent-accent"
                    />
                    <span className="w-8 shrink-0 font-mono text-xs uppercase tracking-widest text-slate-500">
                      {d.id}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{d.name}</span>
                    {auto.has(d.id) && (
                      <span className="shrink-0 rounded-full border border-divider px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-widest text-slate-500">
                        auto
                      </span>
                    )}
                    <span
                      className="w-10 shrink-0 text-right font-mono text-sm tabular-nums"
                      style={{ color: scoreHex(d.score) }}
                    >
                      {d.score}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </ModalBody>
        <ModalFooter>
          <Kicker tone="muted">
            {picked.length === 0 ? "Nothing selected — Ascent picks" : `${picked.length} selected`}
          </Kicker>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPicked([])}
              className={pillClass({ focusRing: true, textSm: true })}
            >
              Reset
            </button>
            <a
              href={skillHref(repoParam, picked)}
              onClick={() => setOpen(false)}
              className={pillClass({ accent: true, focusRing: true, textSm: true })}
            >
              <span aria-hidden>↓</span> Download SKILL.md
            </a>
          </div>
        </ModalFooter>
      </Modal>
    </>
  );
}
