// Sink B names that are not org skills. Kept, not dropped, and never library rows.
import { Caption, Eyebrow, HairlineList } from "@/components/kit";

export function SkillsUnmirroredV2({ rows }: { rows: { name: string; invokes: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-6" data-unmirrored-registry-usage>
      <Eyebrow>Registry usage not in this library</Eyebrow>
      <Caption className="mt-2">
        Sink B samples whose skill name is not an OrgSkill in this org. The registry ran them. Dropping the counts would
        hide that. They do not vote on whether this library&apos;s own skills are unmeasured.
      </Caption>
      <HairlineList className="mt-3">
        {rows.map((row) => (
          <li key={row.name} data-skill={row.name} className="flex items-baseline justify-between gap-3 py-2">
            <span className="min-w-0 truncate font-mono type-caption text-slate-400">{row.name}</span>
            <span data-count className="tabular-nums text-slate-100">
              {row.invokes.toLocaleString()}
            </span>
          </li>
        ))}
      </HairlineList>
    </div>
  );
}
