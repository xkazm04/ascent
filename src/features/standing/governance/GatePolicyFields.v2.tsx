"use client";

// Scalar bars of the Prism gate-policy editor. Text, number, and select controls are FormFields.
// A checkbox-only bar stays a setting row. The same hook owns the values.
import type { LevelId } from "@/lib/types";
import { DimensionMark, FormField, Input, Select, SettingRow } from "@/components/kit";
import { useGatePolicyEditor } from "./useGatePolicyEditor";

const LEVELS: LevelId[] = ["L1", "L2", "L3", "L4", "L5"];

type PolicyForm = ReturnType<typeof useGatePolicyEditor>;

export function GatePolicyFieldsV2({ f }: { f: PolicyForm }) {
  return (
    <div className="mt-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Minimum level" htmlFor="gov-min-level">
          <Select id="gov-min-level" value={f.minLevel} onChange={(e) => f.setMinLevel(e.target.value)}>
            <option value="">any</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Minimum overall" htmlFor="gov-min-overall" hint="Leave blank to set no overall floor. 0 is not a bar.">
          <div className="w-28">
            <Input
              id="gov-min-overall"
              type="number"
              min={1}
              max={100}
              value={f.minOverall}
              onChange={(e) => f.setMinOverall(e.target.value)}
              placeholder="none"
              aria-label="Minimum overall score"
            />
          </div>
        </FormField>
        <FormField label="Minimum per dimension" htmlFor="gov-min-dimension">
          <div className="w-28">
            <Input
              id="gov-min-dimension"
              type="number"
              min={1}
              max={100}
              value={f.minDimension}
              onChange={(e) => f.setMinDimension(e.target.value)}
              placeholder="none"
              aria-label="Minimum score on every dimension"
            />
          </div>
        </FormField>
      </div>
      <FormField
        className="mt-4 max-w-md"
        label={
          <span className="inline-flex items-center gap-2">
            Security floor <DimensionMark id="D9" label="Security" />
          </span>
        }
        htmlFor="gov-security-floor"
      >
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={f.security}
            onChange={(e) => f.setSecurity(e.target.checked)}
            aria-label="Enable security floor"
            className="accent-accent"
          />
          <div className="w-28">
            <Input
              id="gov-security-floor"
              type="number"
              aria-label="Security floor (D9 minimum)"
              min={1}
              max={100}
              value={f.securityFloor}
              disabled={!f.security}
              onChange={(e) => f.setSecurityFloor(e.target.value)}
            />
          </div>
        </div>
      </FormField>
      <div className="mt-4">
        <SettingRow
          label='Forbid "ungoverned" posture'
          control={
            <input
              type="checkbox"
              checked={f.noUngoverned}
              onChange={(e) => f.setNoUngoverned(e.target.checked)}
              aria-label='Forbid "ungoverned" posture'
              className="accent-accent"
            />
          }
        />
        <SettingRow
          label="Require a protected default branch"
          control={
            <input
              type="checkbox"
              checked={f.requireProtection}
              onChange={(e) => f.setRequireProtection(e.target.checked)}
              aria-label="Require a protected default branch"
              className="accent-accent"
            />
          }
        />
      </div>
    </div>
  );
}
