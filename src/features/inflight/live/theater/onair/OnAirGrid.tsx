// THE MONITOR GRID — PGM (two rows tall), PVW 1–3 and the WIRE, laid out as the prototype's multiview.
// Every lane view is a pure function of the pulse, the wall's memory and the (possibly frozen) clock.

import type { LoopPulse } from "@/lib/local/runner-types";
import { blankCard } from "./onairBlank";
import { laneMonitorView } from "./onairLaneModel";
import type { OnAirMemory } from "./onairSlots";
import { wireRows, type Slate } from "./onairWireModel";
import { OnAirLaneMonitor } from "./OnAirLaneMonitor";
import { OnAirWire } from "./OnAirWire";
import styles from "./onairWall.module.css";

const PVW_SLOT = [styles.slotPvw1, styles.slotPvw2, styles.slotPvw3];
/** How long after a wire arrival its tally stays green. */
const WIRE_LIVE_MS = 30_000;

export interface OnAirGridProps {
  pulse: LoopPulse;
  memory: OnAirMemory;
  clock: number;
  stale: boolean;
  heard: string;
  slates: ReadonlyMap<string, Slate>;
  arrivedKeys: ReadonlySet<string>;
  reducedMotion: boolean;
}

export function OnAirGrid({ pulse, memory, clock, stale, heard, slates, arrivedKeys, reducedMotion }: OnAirGridProps) {
  const byId = new Map(pulse.lanes.map((l) => [l.laneId, l]));
  const view = (id: string | null, tapeMax: number) => {
    const lane = id != null ? byId.get(id) : undefined;
    return lane ? laneMonitorView(lane, pulse, memory.acc, clock, tapeMax) : null;
  };
  const pgm = view(memory.slots.pgm, 3);
  const rows = wireRows(pulse, arrivedKeys);
  const newest = rows[0];
  const wireLive = !stale && newest != null && newest.fresh && Date.parse(pulse.at) - Date.parse(pulse.latest[0]!.at) <= WIRE_LIVE_MS;
  const slateFor = (repo: string | undefined) => (repo && !stale ? (slates.get(repo) ?? null) : null);
  return (
    <section className={styles.grid} aria-label="Multiview">
      <OnAirLaneMonitor
        kind="pgm"
        tag="PGM"
        slotClass={styles.slotPgm!}
        view={pgm}
        blank={blankCard(pulse, clock, "program")}
        slate={slateFor(pgm?.repo)}
        heard={heard}
        cuts={memory.slots.cuts}
        reducedMotion={reducedMotion}
      />
      {memory.slots.pvw.map((id, i) => {
        const v = view(id, 2);
        return (
          <OnAirLaneMonitor
            key={i}
            kind="pvw"
            tag={`PVW ${i + 1}`}
            slotClass={PVW_SLOT[i]!}
            view={v}
            blank={blankCard(pulse, clock, `preview ${i + 1}`)}
            slate={slateFor(v?.repo)}
            heard={heard}
            reducedMotion={reducedMotion}
          />
        );
      })}
      <OnAirWire rows={rows} heard={heard} live={wireLive} className={styles.slotWire!} />
    </section>
  );
}
