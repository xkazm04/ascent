// Plate: one labelled strip of a levelled reading. Left: the level name (display, 600) and its band (mono).
// Right: a strip of evidence cells, bright where the evidence was found and a dark absorption line where it is
// missing. `cells` is one boolean per dimension (true = found). Stylised unless the caller measured it: pass
// `honesty="stylised"` for drawn plates.
import { HonestyTag, type HonestyKind } from "./Marks";

export function Plate({
  name,
  band,
  cells,
  selected = false,
  honesty,
  className = "",
}: {
  name: string;
  band: readonly [number, number];
  cells: readonly boolean[];
  selected?: boolean;
  honesty?: HonestyKind;
  className?: string;
}) {
  return (
    <div
      data-kit="plate"
      data-selected={selected || undefined}
      data-role="plate"
      className={`grid grid-cols-[7rem_1fr] items-stretch gap-3 ${selected ? "" : "opacity-75"} ${className}`}
    >
      <div className="flex flex-col justify-center">
        <b data-role="plate-name" className="type-body-sm font-semibold leading-tight text-white">
          {name}
        </b>
        <span data-role="plate-band" className="font-mono type-caption text-slate-400">
          {band[0]}&ndash;{band[1]}
        </span>
      </div>
      <div className="flex min-h-9 items-stretch gap-[3px] overflow-hidden rounded-[3px] border border-divider bg-surface-strong/60 p-[3px]" aria-hidden>
        {cells.map((on, i) => (
          <span
            key={i}
            data-role={on ? "plate-cell-lit" : "plate-cell-dark"}
            className="flex-1 rounded-[1px]"
            style={on ? { background: `var(--spec-${(i % 9) + 1}, var(--color-accent))` } : { background: "rgba(0,0,0,0.55)" }}
          />
        ))}
      </div>
      {honesty && (
        <span className="col-span-2 -mt-1">
          <HonestyTag kind={honesty} />
        </span>
      )}
    </div>
  );
}
