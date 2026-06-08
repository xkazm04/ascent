"use client";

// The segment manager on the Repositories tab. Create named segments (platform, mobile, legacy,
// acquisitions), recolor/remove them, and tag each repo into any number of them. Tagging is
// optimistic — the chip flips immediately and the POST reconciles in the background. The tags drive
// the Overview's segment filter and the segment-vs-segment comparison; all state lives server-side
// (RepoSegment), so this panel only mirrors it.

import { useMemo, useState } from "react";
import { Card, SectionHeader } from "@/components/org/ui";

export interface SegmentItem {
  id: string;
  name: string;
  color: string;
  repoCount: number;
}
export interface RepoItem {
  fullName: string;
  name: string;
}

const PALETTE = ["#3b9eff", "#84cc16", "#f97316", "#a855f7", "#ec4899", "#14b8a6", "#eab308", "#64748b"];

export function RepoSegmentsPanel({
  slug,
  repos,
  segments: initialSegments,
  membership: initialMembership,
}: {
  slug: string;
  repos: RepoItem[];
  segments: SegmentItem[];
  membership: Record<string, string[]>; // fullName -> segmentIds
}) {
  const [segments, setSegments] = useState<SegmentItem[]>(initialSegments);
  const [membership, setMembership] = useState<Record<string, string[]>>(initialMembership);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const segById = useMemo(() => new Map(segments.map((s) => [s.id, s])), [segments]);
  const visibleRepos = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? repos.filter((r) => r.fullName.toLowerCase().includes(q)) : repos;
  }, [repos, filter]);

  async function createSegment() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/segments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, name: n, color }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Failed to create segment.");
      setSegments((s) => [{ id: data.id!, name: n, color, repoCount: 0 }, ...s]);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSegment(id: string) {
    setSegments((s) => s.filter((x) => x.id !== id));
    setMembership((m) => {
      const next: Record<string, string[]> = {};
      for (const [fn, ids] of Object.entries(m)) next[fn] = ids.filter((x) => x !== id);
      return next;
    });
    await fetch(`/api/org/segments/${id}`, { method: "DELETE" });
  }

  async function toggle(fullName: string, segId: string) {
    const current = membership[fullName] ?? [];
    const member = !current.includes(segId);
    // Optimistic: flip the chip + adjust the segment's repo count.
    setMembership((m) => {
      const ids = new Set(m[fullName] ?? []);
      if (member) ids.add(segId);
      else ids.delete(segId);
      return { ...m, [fullName]: [...ids] };
    });
    setSegments((s) => s.map((x) => (x.id === segId ? { ...x, repoCount: Math.max(0, x.repoCount + (member ? 1 : -1)) } : x)));
    await fetch(`/api/org/segments/${segId}/repos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org: slug, fullName, member }),
    }).catch(() => {});
  }

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Segments"
        description="Group repos into named slices (platform, mobile, legacy…). Tags scope the Overview filter and power segment-vs-segment comparison."
      />

      {/* Existing segments + create */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {segments.map((s) => (
          <span key={s.id} className="group inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/60 py-1 pl-2.5 pr-1.5 text-sm">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-slate-200">{s.name}</span>
            <span className="font-mono text-sm text-slate-500">{s.repoCount}</span>
            <button
              type="button"
              onClick={() => removeSegment(s.id)}
              aria-label={`Delete ${s.name} segment`}
              className="ml-0.5 rounded-full px-1 text-slate-600 transition hover:bg-slate-800 hover:text-orange-300"
            >
              ×
            </button>
          </span>
        ))}
        {segments.length === 0 && <span className="text-sm text-slate-500">No segments yet — create one to start tagging.</span>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
        <div className="flex items-center gap-1">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
              className={`h-5 w-5 rounded-full border transition ${color === c ? "border-white" : "border-transparent"}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createSegment()}
          placeholder="New segment name"
          className="min-w-[10rem] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
        />
        <button
          onClick={createSegment}
          disabled={busy || !name.trim()}
          className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add segment"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-orange-300">{error}</p>}

      {/* Per-repo tagging */}
      {segments.length > 0 && (
        <div className="mt-6 border-t border-slate-800 pt-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-mono text-sm uppercase tracking-widest text-slate-400">Tag repositories</h3>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter repos…"
              className="w-40 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-sm text-slate-200 placeholder:text-slate-600"
            />
          </div>
          <div className="mt-3 max-h-96 space-y-1.5 overflow-y-auto pr-1">
            {visibleRepos.map((r) => {
              const ids = new Set(membership[r.fullName] ?? []);
              return (
                <div key={r.fullName} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-sm text-slate-300" title={r.fullName}>
                    {r.fullName}
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    {segments.map((s) => {
                      const on = ids.has(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggle(r.fullName, s.id)}
                          aria-pressed={on}
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-sm transition"
                          style={
                            on
                              ? { backgroundColor: s.color, borderColor: s.color, color: "#04070e" }
                              : { borderColor: "#334155", color: "#94a3b8" }
                          }
                        >
                          {!on && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />}
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {visibleRepos.length === 0 && <p className="text-sm text-slate-500">No repos match “{filter}”.</p>}
          </div>
          <p className="mt-2 font-mono text-sm text-slate-600">{segById.size} segment{segById.size === 1 ? "" : "s"} · {repos.length} repos</p>
        </div>
      )}
    </Card>
  );
}
