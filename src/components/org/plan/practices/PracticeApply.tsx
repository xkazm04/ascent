"use client";

import { useMemo, useState } from "react";
import { artifactFingerprint } from "@/lib/practices/fingerprint";
import { type Artifact, type OpenPrRef, type RepoRef } from "./practiceApplyShared";
import { PracticeApplyBatch } from "./PracticeApplyBatch";

/**
 * The "systematic apply" action on a practice card: pick a gap repo, preview the leak-free
 * starter artifact Ascent would generate, then open a draft PR seeding it. Preview is read-only;
 * opening a PR needs the GitHub App installed with write access (the route enforces it and we
 * surface its error inline).
 *
 * `openPrs` is the practice's live PR lifecycle (getOrgPractices → OrgPractice.openPrs): a repo that
 * already has a starter PR in flight is shown that PR rather than an apply button, because a second
 * apply would only re-surface the same `ascent/<practice>` branch.
 */
export function PracticeApply({
  practiceId,
  gapRepos,
  openPrs = [],
}: {
  practiceId: string;
  gapRepos: RepoRef[];
  openPrs?: OpenPrRef[];
}) {
  const [repo, setRepo] = useState(gapRepos[0]?.fullName ?? "");
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pr, setPr] = useState<{ url: string; reused: boolean } | null>(null);
  // Owned by the extracted batch panel; mirrored here because the two are mutually locked.
  const [batchBusy, setBatchBusy] = useState(false);

  const openPrByRepo = useMemo(() => new Map(openPrs.map((p) => [p.repoFullName, p])), [openPrs]);

  if (gapRepos.length === 0) return null;

  const livePr = openPrByRepo.get(repo);

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
    // content the user never reviewed. The fingerprint extends the same contract to CONTENT: the
    // server regenerates at apply time, so it compares against the body we rendered and 409s if the
    // repo's context changed since the preview.
    if (!artifact) return;
    const target = artifact.repo;
    setBusy("apply");
    setError(null);
    try {
      const res = await fetch("/api/practices/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: target, practiceId, previewFingerprint: artifactFingerprint(artifact.body) }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Content drift: the preview is stale — drop it so the apply button disappears until the
        // user re-previews the regenerated starter.
        if (data.code === "content-drift") setArtifact(null);
        throw new Error(data.error ?? "Failed to open PR.");
      }
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
          // Programmatic name for the control: it has no visible <label> (the "Apply to a repo" heading is
          // a styled <div>), so a screen reader would otherwise announce only "combobox" on a control that
          // drives a write to a customer repo (WCAG 4.1.2 / 1.3.1).
          aria-label="Repository to apply this practice to"
          // Disabled during a preview/apply so the selection can't change out from under an in-flight
          // request — the core fix for the stale-preview-applied-to-the-wrong-repo race.
          disabled={busy !== null || batchBusy}
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
              {openPrByRepo.has(r.fullName) ? `${r.name} · PR open` : r.name}
            </option>
          ))}
        </select>
        {/* A live starter PR for this repo → link it instead of offering a duplicate apply. The
            practice's branch is per-repo unique, so a second apply only re-surfaces this same PR. */}
        {livePr ? (
          <span className="font-mono text-sm text-slate-400">
            PR already open:{" "}
            <a href={livePr.prUrl} target="_blank" rel="noreferrer" className="text-accent underline hover:text-white">
              #{livePr.prNumber}
            </a>
          </span>
        ) : (
          <>
            <button
              onClick={preview}
              disabled={busy !== null || batchBusy}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-accent hover:text-white disabled:opacity-50"
            >
              {busy === "preview" ? "Generating…" : "Preview starter"}
            </button>
            {artifact && artifact.repo === repo && (
              <button
                onClick={apply}
                disabled={busy !== null || batchBusy}
                className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
              >
                {busy === "apply" ? "Opening PR…" : "Open draft PR →"}
              </button>
            )}
          </>
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
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="font-mono text-sm text-slate-400 hover:text-white">
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
        <PracticeApplyBatch
          practiceId={practiceId}
          gapRepos={gapRepos}
          openPrs={openPrByRepo}
          singleBusy={busy !== null}
          onBusyChange={setBatchBusy}
        />
      )}
    </div>
  );
}
