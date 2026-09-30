"use client";

// Prism cadence control. Same POST, optimistic rollback, and focusable aria-disabled as ScheduleSelect.
// The visible control is the kit field so the row is not a raw mono select under Prism CSS.
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { FormField, Select } from "@/components/kit";
import { SCHEDULES as OPTIONS, scheduleLabel, type Schedule } from "@/lib/org/repo-schedule";

function normalize(s: string): Schedule {
  return (OPTIONS as readonly string[]).includes(s) ? (s as Schedule) : "off";
}

export function ScheduleSelectV2({
  org,
  fullName,
  schedule,
  disabled,
  disabledHint,
}: {
  org: string;
  fullName: string;
  schedule: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState<Schedule>(normalize(schedule));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const hintId = useId();
  const inert = disabled || saving;

  async function onChange(next: Schedule) {
    if (inert) return;
    const prev = value;
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/org/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, fullName, schedule: next }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        setValue(prev);
        setError(d?.error ?? `Failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setValue(prev);
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span data-tour="watch-schedule" className="inline-flex w-40 flex-col items-stretch">
      <FormField label="Cadence" htmlFor={fieldId} error={error ?? undefined}>
        <Select
          id={fieldId}
          value={value}
          aria-disabled={inert || undefined}
          title={disabled ? disabledHint : undefined}
          onChange={(e) => onChange(normalize(e.target.value))}
          aria-label={`Autoscan cadence for ${fullName}`}
          aria-describedby={disabled && disabledHint ? hintId : undefined}
          className={inert ? "cursor-not-allowed" : undefined}
        >
          {OPTIONS.map((o) => (
            <option key={o} value={o}>
              {scheduleLabel(o)}
            </option>
          ))}
        </Select>
        {disabled && disabledHint && (
          <span id={hintId} className="sr-only">
            {disabledHint}
          </span>
        )}
      </FormField>
    </span>
  );
}
