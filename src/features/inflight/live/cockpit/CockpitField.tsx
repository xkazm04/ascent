"use client";

// The cockpit's dominant object: the observatory sky chart, plus the fleet list that folds out from
// under it. Extracted from LiveCockpit so that file is the orchestrator and nothing else — the split
// is the screen's own (left = what the fleet IS, right = what you are doing about it).

import { Surface } from "@/components/ui";
import { ObservatoryField, ObservatoryList, type ObservatoryBody } from "../observatory";
import type { CockpitDrift } from "./cockpitDrift";

export interface CockpitFieldProps {
  bodies: ObservatoryBody[];
  selected: ReadonlySet<string>;
  onSelect: (next: Set<string>) => void;
  /** Repos whose lane is rescanning right now — the field pulses them. */
  scanning: ReadonlySet<string>;
  drift: CockpitDrift | null;
  onOpen: (fullName: string) => void;
  listOpen: boolean;
  onToggleList: () => void;
  /** No card around it: the Prism composition lets the sky sit on the page (a hairline, not a box). */
  bare?: boolean;
}

export function CockpitField(props: CockpitFieldProps) {
  const { bodies, selected, onSelect, scanning, drift, onOpen, listOpen, onToggleList, bare = false } = props;
  const Shell = bare ? "div" : Surface;
  return (
    <Shell className={bare ? "min-w-0" : "min-w-0 p-3"}>
      <ObservatoryField bodies={bodies} selected={selected} onSelect={onSelect} scanning={scanning} drift={drift} onBodyOpen={onOpen} />
      <div className="mt-2 border-t border-divider pt-2">
        <button
          type="button"
          onClick={onToggleList}
          aria-expanded={listOpen}
          className="focus-ring rounded type-label tracking-[0.18em] text-slate-500 hover:text-accent"
        >
          {listOpen ? "Hide fleet list" : "Show fleet list"}
        </button>
        {listOpen && <ObservatoryList bodies={bodies} selected={selected} onSelect={onSelect} onOpen={onOpen} className="mt-2" />}
      </div>
    </Shell>
  );
}
