"use client";

// Per-dimension floors other than D9, for the Prism policy editor. D9 stays on the security
// control in the parent: it is the named min-security input and it also forbids "ungoverned".
import { DIMENSIONS } from "@/lib/maturity/model";
import { Caption, DimensionMark, Eyebrow, FormField, GhostAction, Input, Select } from "@/components/kit";

const FLOOR_DIMENSIONS = DIMENSIONS.filter((d) => d.id !== "D9");

export function DimensionFloorRowsV2({
  floors,
  onChange,
}: {
  floors: Record<string, string>;
  onChange: (dimId: string, value: string | null) => void;
}) {
  const configured = FLOOR_DIMENSIONS.filter((d) => floors[d.id] != null);
  const available = FLOOR_DIMENSIONS.filter((d) => floors[d.id] == null);

  return (
    <div className="mt-6">
      <Eyebrow>Other dimension floors</Eyebrow>
      <Caption className="mt-2">
        Enforced by the gate. The CI snippet carries each as <code className="font-mono">min-d&lt;N&gt;</code>.
      </Caption>
      {configured.length === 0 ? (
        <p className="mt-3 type-body-sm text-slate-400">
          No per-dimension floors beyond Security. Add one to hold every repo to a minimum on a specific dimension.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {configured.map((d) => (
            <li key={d.id} className="flex items-end gap-3">
              <FormField
                className="min-w-0 flex-1"
                label={
                  <span className="inline-flex items-center gap-2">
                    <DimensionMark id={d.id} label={d.name} />
                    {d.name}
                  </span>
                }
                htmlFor={`gov-floor-${d.id}`}
              >
                <div className="w-28">
                  <Input
                    id={`gov-floor-${d.id}`}
                    type="number"
                    aria-label={`${d.id} ${d.name} minimum score`}
                    min={1}
                    max={100}
                    value={floors[d.id] ?? ""}
                    onChange={(e) => onChange(d.id, e.target.value)}
                  />
                </div>
              </FormField>
              <GhostAction onClick={() => onChange(d.id, null)} aria-label={`Remove the ${d.id} ${d.name} floor`}>
                Remove
              </GhostAction>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && (
        <FormField label="Add a floor" htmlFor="gov-add-floor" className="mt-4 max-w-md">
          <Select
            id="gov-add-floor"
            value=""
            onChange={(e) => {
              if (e.target.value) onChange(e.target.value, "50");
            }}
          >
            <option value="">Select a dimension</option>
            {available.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id} · {d.name}
              </option>
            ))}
          </Select>
        </FormField>
      )}
    </div>
  );
}
