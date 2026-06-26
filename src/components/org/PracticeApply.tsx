"use client";

import { useState } from "react";

interface RepoRef {
  name: string;
  fullName: string;
}

interface Artifact {
  path: string;
  body: string;
  /** The repo this artifact was previewed for. Apply must target THIS repo, not whatever the dropdown
   *  reads now — otherwise a stale preview response can be applied to a different repo (see preview()). */
  repo: string;
}

interface BatchResult {
  repo: string;
  ok: boolean;
  url?: string;
  reused?: boolean;
  error?: string;
}

// Mirror the server's per-batch cap (src/app/api/practices/apply-batch/route.ts MAX_BATCH). The route
// truncates to the FIRST MAX_BATCH repos it receives and returns the over-cap count as `skipped`, so we
// (a) send the neediest repos first and (b) surface `skipped` instead of implying full coverage.
const MAX_BATCH = 25;

/**
 * The "systematic apply" action on a practice card: pick a gap repo, preview the leak-free
 * starter artifact Ascent would generate, then open a draft PR seeding it. Preview is read-only;
 * opening a PR needs the GitHub App installed with write access (the route enforces it and we
 * surface its error inline).
 */
export function PracticeApply({ practiceId, gapRepos }: { practiceId: string; gapRepos: RepoRef[] }) {
  const [repo, setRepo] = useState(gapRepos[0]?.fullName ?? "");
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pr, setPr] = useState<{ url: string; reused: boolean } | null>(null);
  // Fleet rollout: open a draft PR across many gap repos at once (default = all of them).
  const [showBatch, setShowBatch] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(gapRepos.map((r) => r.fullName)));
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchResult[] | null>(null);
  const [batchSummary, setBatchSummary] = useState<{ attempted: number; skipped: number } | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  if (gapRepos.length === 0) return null;

  function toggleSelected(fullName: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  }

  async function applyBatch() {
    // gapRepos is ordered highest-score-first (least needy), so the repos most in need of remediation
    // are LAST. The server keeps the first MAX_BATCH repos it receives when truncating, so send the
    // neediest first — otherwise the cap would silently drop exactly the repos the rollout should fix.
    const repos = gapRepos
      .filter((r) => selected.has(r.fullName))
      .map((r) => r.fullName)
      .reverse();
    if (repos.length === 0) return;
    setBatchBusy(true);
    setBatchError(null);
    setBatchResults(null);
    setBatchSummary(null);
    try {
      const res = await fetch("/api/practices/apply-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repos, practiceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to open PRs.");
      const results = data.results as BatchResult[];
      setBatchResults(results);
      setBatchSummary({
        attempted: typeof data.attempted === "number" ? data.attempted : results.length,
        skipped: typeof data.skipped === "number" ? data.skipped : 0,
      });
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : "Failed to open PRs.");
    } finally {
      setBatchBusy(false);
    }
  }

  async function preview() {
    setBusy("preview");
    setError(null);
    setPr(null);
    const target = repo; // capture: ignore a response that arrives after the selection changed
    try {
      const res = await fetch("/api/practices/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: target, practiceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate.");
      // Stamp the artifact with the repo it was generated for, so apply can't post a different one.
      setArtifact({ path: data.artifact.path, body: data.artifact.body, repo: target });
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate.");
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    // Apply the repo we actually PREVIEWED, never whatever the dropdown reads now — the previewed
    // artifact (commands/description) is repo-specific, so opening a PR in a different repo would land
    // content the user never reviewed.
    const target = artifact?.repo;
    if (!target) return;
    setBusy("apply");
    setError(null);
    try {
      const res = await fetch("/api/practices/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: target, practiceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to open PR.");
      setPr({ url: data.url, reused: data.reused });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open PR.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="font-mono text-sm uppercase tracking-widest text-accent">Apply to a repo</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={repo}
          // Disabled during a preview/apply so the selection can't change out from under an in-flight
          // request — the core fix for the stale-preview-applied-to-the-wrong-repo race.
          disabled={busy !== null}
          onChange={(e) => {
            setRepo(e.target.value);
            setArtifact(null);
            setPr(null);
            setError(null);
          }}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200 disabled:opacity-50"
        >
          {gapRepos.map((r) => (
            <option key={r.fullName} value={r.fullName}>
              {r.name}
            </option>
          ))}
        </select>
        <button
          onClick={preview}
          disabled={busy !== null}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-accent hover:text-white disabled:opacity-50"
        >
          {busy === "preview" ? "Generating…" : "Preview starter"}
        </button>
        {artifact && artifact.repo === repo && (
          <button
            onClick={apply}
            disabled={busy !== null}
            className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
          >
            {busy === "apply" ? "Opening PR…" : "Open draft PR →"}
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-orange-300">{error}</p>}
      {pr && (
        <p className="mt-2 text-sm text-emerald-300">
          {pr.reused ? "Existing draft PR: " : "Draft PR opened: "}
          <a href={pr.url} target="_blank" rel="noreferrer" className="underline hover:text-white">
            {pr.url}
          </a>
        </p>
      )}

      {artifact && (
        <div className="mt-3">
          <button onClick={() => setOpen((o) => !o)} className="font-mono text-sm text-slate-400 hover:text-white">
            {open ? "▾" : "▸"} {artifact.path}
          </button>
          {open && (
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-800 bg-black/40 p-3 font-mono text-sm leading-relaxed text-slate-300">
              {artifact.body}
            </pre>
          )}
        </div>
      )}

      {gapRepos.length > 1 && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <button
            onClick={() => setShowBatch((s) => !s)}
            className="font-mono text-sm uppercase tracking-widest text-accent hover:text-white"
          >
            {showBatch ? "▾" : "▸"} Roll out to the fleet ({gapRepos.length} repos)
          </button>
          {showBatch && (
            <div className="mt-2">
              <div className="mb-2 flex flex-wrap items-center gap-3 font-mono text-sm text-slate-500">
                <button onClick={() => setSelected(new Set(gapRepos.map((r) => r.fullName)))} className="hover:text-white">
                  select all
                </button>
                <button onClick={() => setSelected(new Set())} className="hover:text-white">
                  none
                </button>
                <span>{selected.size} selected</span>
              </div>
              <div className="grid max-h-44 gap-1 overflow-auto rounded-lg border border-slate-800 bg-slate-950/40 p-3 sm:grid-cols-2">
                {gapRepos.map((r) => (
                  <label key={r.fullName} className="flex items-center gap-2 font-mono text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={selected.has(r.fullName)}
                      onChange={() => toggleSelected(r.fullName)}
                      className="accent-accent"
                    />
                    {r.name}
                  </label>
                ))}
              </div>
              <button
                onClick={applyBatch}
                disabled={batchBusy || selected.size === 0}
                className="mt-3 rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
              >
                {batchBusy
                  ? `Opening ${selected.size} PRs…`
                  : `Open draft PRs across ${selected.size} repo${selected.size === 1 ? "" : "s"} →`}
              </button>
              {batchError && <p className="mt-2 text-sm text-orange-300">{batchError}</p>}
              {batchSummary && batchSummary.skipped > 0 && (
                <p className="mt-2 text-sm text-amber-300">
                  Opened {batchSummary.attempted} of {batchSummary.attempted + batchSummary.skipped} —{" "}
                  {batchSummary.skipped} over the per-batch cap of {MAX_BATCH} (neediest repos first). Re-run to open the rest.
                </p>
              )}
              {batchResults && (
                <ul className="mt-2 space-y-1">
                  {batchResults.map((res) => (
                    <li key={res.repo} className="font-mono text-sm">
                      {res.ok ? (
                        <span className="text-emerald-300">
                          ✓ {res.repo.split("/").pop()} —{" "}
                          <a href={res.url} target="_blank" rel="noreferrer" className="underline hover:text-white">
                            {res.reused ? "existing PR" : "PR opened"}
                          </a>
                        </span>
                      ) : (
                        <span className="text-orange-300">
                          ✗ {res.repo.split("/").pop()} — {res.error}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
