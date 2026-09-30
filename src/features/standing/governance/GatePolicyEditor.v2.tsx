"use client";

// Prism editor for the org gate policy. Same hook and the same three sub-forms as the Altimeter
// editor, laid out as setting rows. Save and reset post through useGatePolicyEditor unchanged.
import type { GatePolicy } from "@/lib/scoring/gate";
import type { LevelId } from "@/lib/types";
import { DimensionMark, Eyebrow, GhostAction, PrimaryAction, SettingRow } from "@/components/kit";
import { useGatePolicyEditor } from "./useGatePolicyEditor";
import { AiGovernedRateRow } from "./AiGovernedRateRow";
import { DimensionFloorRows } from "./DimensionFloorRows";
import { RequireChecksRows } from "./RequireChecksRows";

const LEVELS: LevelId[] = ["L1", "L2", "L3", "L4", "L5"];
const FIELD =
  "rounded border border-divider bg-ink px-2 py-1 text-slate-200 outline-none focus:border-accent disabled:opacity-50";

export function GatePolicyEditorV2({ org, initial }: { org: string; initial: GatePolicy | null }) {
  const f = useGatePolicyEditor(org, initial);
  return (
    <div className="mt-8">
      <Eyebrow>Edit policy</Eyebrow>
      <div className="mt-3">
        <SettingRow
          label="Minimum level"
          control={
            <select
              value={f.minLevel}
              onChange={(e) => f.setMinLevel(e.target.value)}
              className={`${FIELD} type-body-sm`}
            >
              <option value="">any</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          }
        />
        <SettingRow
          label="Minimum overall"
          description="Leave blank to set no overall floor. 0 is not a bar."
          control={
            <input
              type="number"
              min={1}
              max={100}
              value={f.minOverall}
              onChange={(e) => f.setMinOverall(e.target.value)}
              placeholder="none"
              aria-label="Minimum overall score"
              className={`${FIELD} w-20 type-body-sm`}
            />
          }
        />
        <SettingRow
          label="Minimum per dimension"
          control={
            <input
              type="number"
              min={1}
              max={100}
              value={f.minDimension}
              onChange={(e) => f.setMinDimension(e.target.value)}
              placeholder="none"
              aria-label="Minimum score on every dimension"
              className={`${FIELD} w-20 type-body-sm`}
            />
          }
        />
        <SettingRow
          label={
            <span className="inline-flex items-center gap-2">
              Security floor <DimensionMark id="D9" label="Security" />
            </span>
          }
          control={
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={f.security}
                onChange={(e) => f.setSecurity(e.target.checked)}
                aria-label="Enable security floor"
                className="accent-accent"
              />
              <input
                type="number"
                aria-label="Security floor (D9 minimum)"
                min={1}
                max={100}
                value={f.securityFloor}
                disabled={!f.security}
                onChange={(e) => f.setSecurityFloor(e.target.value)}
                className={`${FIELD} w-20 type-body-sm`}
              />
            </span>
          }
        />
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
      <DimensionFloorRows floors={f.otherFloors} onChange={f.setDimFloor} />
      <AiGovernedRateRow enabled={f.aiGoverned} rate={f.aiGovernedRate} onEnabled={f.setAiGoverned} onRate={f.setAiGovernedRate} />
      <RequireChecksRows checks={f.requireChecks} onAdd={f.addRequireCheck} onRemove={f.removeRequireCheck} />
      <div className="mt-4 flex flex-wrap items-center gap-3" aria-busy={f.busy !== null}>
        <PrimaryAction onClick={() => f.save()} disabled={f.busy !== null}>
          {f.busy === "save" ? "Saving…" : "Save policy"}
        </PrimaryAction>
        <GhostAction onClick={f.reset} disabled={f.busy !== null}>
          Reset to default
        </GhostAction>
      </div>
      <div role="status" aria-live="polite" className="mt-3">
        <p className="type-body-sm text-slate-200">{f.msg ? (f.msg.kind === "error" ? `Error: ${f.msg.text}` : f.msg.text) : ""}</p>
        {f.applies ? <p className="mt-1 type-body-sm text-slate-400">{f.applies}</p> : null}
      </div>
    </div>
  );
}
