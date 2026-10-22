// The registry's capability sentences, plus the per-repo attribution note. No status hue.
import { Caption } from "@/components/kit";

export function CapabilityNotes({ items, note }: { items: readonly string[]; note: string }) {
  return (
    <div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item} className="type-body-sm text-slate-400">
            {item}
          </li>
        ))}
      </ul>
      <Caption>{note}</Caption>
    </div>
  );
}
