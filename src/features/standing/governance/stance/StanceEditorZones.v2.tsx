"use client";

// No-AI zones inside the Prism stance editor. Path globs stay labelled advisory.
import { FormField, GhostAction, Input } from "@/components/kit";
import type { ZoneForm } from "./useStanceEditor";

export function StanceEditorZonesV2({
  zones,
  onChange,
  onAdd,
  onRemove,
}: {
  zones: ZoneForm[];
  onChange: (i: number, patch: Partial<ZoneForm>) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <p className="type-body-sm text-slate-200">No-AI zones</p>
        <GhostAction onClick={onAdd}>Add zone</GhostAction>
      </div>
      {zones.length === 0 && <p className="mt-2 type-body-sm text-slate-400">No zones declared.</p>}
      <div className="mt-2">
        {zones.map((z, i) => (
          <div key={i} className="grid gap-3 border-t border-divider py-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <FormField label="Repo globs" htmlFor={`gov-zone-${i}-repo`}>
              <Input
                id={`gov-zone-${i}-repo`}
                value={z.repoGlobs}
                onChange={(e) => onChange(i, { repoGlobs: e.target.value })}
                placeholder="acme/billing-*"
              />
            </FormField>
            <FormField label="Path globs" htmlFor={`gov-zone-${i}-path`} hint="Advisory, not checked yet">
              <Input
                id={`gov-zone-${i}-path`}
                value={z.pathGlobs}
                onChange={(e) => onChange(i, { pathGlobs: e.target.value })}
                placeholder="prisma/migrations/**"
              />
            </FormField>
            <FormField label="Why" htmlFor={`gov-zone-${i}-why`}>
              <Input
                id={`gov-zone-${i}-why`}
                value={z.reason}
                onChange={(e) => onChange(i, { reason: e.target.value })}
                placeholder="PCI scope"
              />
            </FormField>
            <GhostAction onClick={() => onRemove(i)} aria-label={`Remove zone ${i + 1}`}>
              Remove
            </GhostAction>
          </div>
        ))}
      </div>
    </div>
  );
}
