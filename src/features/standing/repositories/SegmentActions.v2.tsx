"use client";

// Prism per-segment cadence and scan. Same posts as SegmentActions; option labels go through scheduleLabel.
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { FormField, PrimaryAction, Select } from "@/components/kit";
import { readSSE } from "@/lib/sse";
import { SCHEDULES, scheduleLabel } from "@/lib/org/repo-schedule";

interface ScanState {
  running: boolean;
  done: number;
  total: number;
  error?: string;
}

export function SegmentActionsV2({
  org,
  segmentId,
  repos,
  taggedCount = repos.length,
}: {
  org: string;
  segmentId: string;
  repos: string[];
  taggedCount?: number;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [cadence, setCadence] = useState("");
  const [cadenceBusy, setCadenceBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanState | null>(null);

  async function setSchedule(schedule: string) {
    if (!schedule) return;
    const prevCadence = cadence;
    setCadence(schedule);
    setCadenceBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/org/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, segmentId, schedule }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Failed to set cadence.");
      setNote(`Cadence ${schedule} set for ${d.updated ?? "the segment's"} watched repo(s).`);
      router.refresh();
    } catch (e) {
      setCadence(prevCadence);
      setNote(e instanceof Error ? e.message : "Failed to set cadence.");
    } finally {
      setCadenceBusy(false);
    }
  }

  async function scanSegment() {
    if (repos.length === 0) return;
    setScan({ running: true, done: 0, total: repos.length });
    try {
      const res = await fetch("/api/org/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, repos }),
      });
      if (!res.ok || !res.body) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        setScan({ running: false, done: 0, total: repos.length, error: d?.error ?? `Failed (${res.status}).` });
        return;
      }
      await readSSE(res.body, ({ event, data }) => {
        if (!data) return;
        if (event === "progress") {
          setScan((s) => (s ? { ...s, done: Number(data.index) || s.done, total: Number(data.total) || s.total } : s));
        } else if (event === "error") {
          setScan((s) => (s ? { ...s, running: false, error: String(data.error) } : s));
        }
      });
      setScan((s) => (s ? { ...s, running: false } : s));
      router.refresh();
    } catch {
      setScan((s) => (s ? { ...s, running: false, error: "Network error." } : s));
    }
  }

  const scanTitle =
    repos.length === 0
      ? taggedCount > 0
        ? `None of this segment's ${taggedCount} tagged repo(s) are watched. Watch them on the Repositories tab to scan`
        : "No repos tagged into this segment yet"
      : "Scan the watched repos in this segment";
  const scanLabel = scan?.running
    ? `Scanning ${scan.done}/${scan.total}…`
    : `Scan segment (${repos.length < taggedCount ? `${repos.length} of ${taggedCount} watched` : repos.length})`;

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-divider pt-3">
      <FormField label="Cadence" htmlFor={fieldId} className="min-w-36">
        <Select
          id={fieldId}
          value={cadence}
          disabled={cadenceBusy}
          onChange={(e) => setSchedule(e.target.value)}
          aria-label="Set autoscan cadence for this segment"
        >
          <option value="">Cadence…</option>
          {SCHEDULES.map((c) => (
            <option key={c} value={c}>
              {scheduleLabel(c)}
            </option>
          ))}
        </Select>
      </FormField>
      <span title={scanTitle}>
        <PrimaryAction onClick={scanSegment} disabled={!!scan?.running || repos.length === 0}>
          {scanLabel}
        </PrimaryAction>
      </span>
      {note && <span className="type-body-sm text-slate-400">{note}</span>}
      {scan?.error && (
        <span role="alert" className="type-body-sm text-slate-100">
          <span aria-hidden>! </span>
          {scan.error}
        </span>
      )}
    </div>
  );
}
