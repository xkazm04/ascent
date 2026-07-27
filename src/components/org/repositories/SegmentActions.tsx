"use client";

// Per-segment scan + cadence controls — exposes the segment-scoped backend that already existed but
// had no UI: POST /api/org/schedule { org, segmentId, schedule } sets the whole segment's autoscan
// cadence in one write (setWatchedSchedule + segmentScope), and POST /api/org/scan { org, repos }
// scans just this segment's watched repos (SSE progress, like OrgScanButton). "Scan segment" /
// "set cadence" on a slice instead of the whole fleet.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { readSSE } from "@/lib/sse";

const CADENCES = ["off", "daily", "weekly", "monthly"] as const;

interface ScanState {
  running: boolean;
  done: number;
  total: number;
  error?: string;
}

export function SegmentActions({
  org,
  segmentId,
  repos,
  taggedCount = repos.length,
}: {
  org: string;
  segmentId: string;
  /** The WATCHED repos in this segment — exactly what POST /api/org/scan will accept. The server
   *  intersects the request with the watch list, so passing every tagged repo made the button promise
   *  "Scan segment (7)", briefly show "0/7…", then snap to 3 mid-flight (repositories-segments #2). */
  repos: string[];
  /** How many repos are tagged into the segment in total (>= repos.length); shown so the label can
   *  say "3 of 7 watched" instead of overstating scope. */
  taggedCount?: number;
}) {
  const router = useRouter();
  const [cadence, setCadence] = useState("");
  const [cadenceBusy, setCadenceBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanState | null>(null);

  async function setSchedule(schedule: string) {
    if (!schedule) return;
    // Snapshot the prior selection so a server rejection (403 / validation / network) can REVERT the
    // dropdown — otherwise it keeps displaying a cadence the server never accepted, i.e. phantom state.
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
      setCadence(prevCadence); // the server didn't take it — don't leave the rejected value selected
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

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
      <select
        value={cadence}
        disabled={cadenceBusy}
        onChange={(e) => setSchedule(e.target.value)}
        aria-label="Set autoscan cadence for this segment"
        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-300 outline-none focus:border-accent disabled:opacity-50"
      >
        <option value="">Cadence…</option>
        {CADENCES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button
        onClick={scanSegment}
        disabled={!!scan?.running || repos.length === 0}
        title={
          repos.length === 0
            ? taggedCount > 0
              ? `None of this segment's ${taggedCount} tagged repo(s) are watched — watch them on the Repositories tab to scan`
              : "No repos tagged into this segment yet"
            : "Scan the watched repos in this segment"
        }
        className="rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 font-mono text-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
      >
        {scan?.running
          ? `Scanning ${scan.done}/${scan.total}…`
          : // Honest scope: only the WATCHED slice is scanned, so say so whenever it's a subset.
            `Scan segment (${repos.length < taggedCount ? `${repos.length} of ${taggedCount} watched` : repos.length})`}
      </button>
      {note && <span className="font-mono text-sm text-slate-500">{note}</span>}
      {scan?.error && <span className="font-mono text-sm text-orange-300">{scan.error}</span>}
    </div>
  );
}
