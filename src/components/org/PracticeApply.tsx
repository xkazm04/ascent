"use client";

import { useState } from "react";

interface RepoRef {
  name: string;
  fullName: string;
}

interface Artifact {
  path: string;
  title: string;
  body: string;
  prTitle: string;
}

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

  if (gapRepos.length === 0) return null;

  async function preview() {
    setBusy("preview");
    setError(null);
    setPr(null);
    try {
      const res = await fetch("/api/practices/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo, practiceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate.");
      setArtifact(data.artifact);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate.");
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    setBusy("apply");
    setError(null);
    try {
      const res = await fetch("/api/practices/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo, practiceId }),
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
          onChange={(e) => {
            setRepo(e.target.value);
            setArtifact(null);
            setPr(null);
            setError(null);
          }}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200"
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
        {artifact && (
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
    </div>
  );
}
