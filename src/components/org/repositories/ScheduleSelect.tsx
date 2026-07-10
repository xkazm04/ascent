"use client";

// Per-repo autoscan cadence control for the org repositories leaderboard. POSTs to the existing
// /api/org/schedule (off | daily | weekly | monthly), which persists scanSchedule + nextScanAt and
// is drained by /api/cron/rescan. The whole scheduling backend was already built; until now no org
// view ever called it, so the continuous-tracking loop was unconfigurable from the dashboard users
// actually live in. Optimistic with rollback (mirrors the connect list's toggleWatch pattern).

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SCHEDULES as OPTIONS, type Schedule } from "@/components/connect/installationRepoTypes";

function normalize(s: string): Schedule {
  return (OPTIONS as readonly string[]).includes(s) ? (s as Schedule) : "off";
}

export function ScheduleSelect({
  org,
  fullName,
  schedule,
  disabled,
  disabledHint,
}: {
  org: string;
  fullName: string;
  schedule: string;
  /** Disable the control (e.g. the GitHub App isn't configured, so the route would 503). */
  disabled?: boolean;
  disabledHint?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState<Schedule>(normalize(schedule));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(next: Schedule) {
    const prev = value;
    setValue(next); // optimistic
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
        setValue(prev); // rollback
        setError(d?.error ?? `Failed (${res.status})`);
        return;
      }
      // Pull fresh nextScanAt / rollup state.
      router.refresh();
    } catch {
      setValue(prev);
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <select
        value={value}
        disabled={disabled || saving}
        title={disabled ? disabledHint : undefined}
        onChange={(e) => onChange(normalize(e.target.value))}
        aria-label={`Autoscan cadence for ${fullName}`}
        className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 font-mono text-sm text-slate-300 transition hover:border-accent focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {error && <span className="font-mono text-sm text-red-400">{error}</span>}
    </span>
  );
}
