"use client";

// Prism apply. Same preview, fingerprint, and batch as Altimeter. The repo picker is a FormField.
import { useMemo, useState } from "react";
import { FormField, GhostAction, PrimaryAction, Select } from "@/components/kit";
import { artifactFingerprint } from "@/lib/practices/fingerprint";
import { type Artifact, type OpenPrRef, type RepoRef } from "./practiceApplyShared";
import { PracticeApplyBatch } from "./PracticeApplyBatch";
import { PracticePreviewKicker, previewShapeFromPayload } from "./PracticePreviewKicker";

export function PracticeApplyV2({
  org,
  practiceId,
  gapRepos,
  openPrs = [],
}: {
  /** The dashboard org: the apply gate, mint, audit row and house pattern key on it, never on the repo owner. */
  org: string;
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
  const [batchBusy, setBatchBusy] = useState(false);
  const openPrByRepo = useMemo(() => new Map(openPrs.map((p) => [p.repoFullName, p])), [openPrs]);
  if (gapRepos.length === 0) return null;

  const livePr = openPrByRepo.get(repo);
  const locked = busy !== null || batchBusy;
  const fieldId = `apply-repo-${practiceId}`;

  async function preview() {
    setBusy("preview");
    setError(null);
    setPr(null);
    const target = repo;
    try {
      const res = await fetch("/api/practices/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, repo: target, practiceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate.");
      setArtifact({ path: data.artifact.path, body: data.artifact.body, repo: target, shape: previewShapeFromPayload(data) });
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate.");
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!artifact) return;
    const target = artifact.repo;
    setBusy("apply");
    setError(null);
    try {
      const res = await fetch("/api/practices/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, repo: target, practiceId, previewFingerprint: artifactFingerprint(artifact.body) }),
      });
      const data = await res.json();
      if (!res.ok) {
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
    <div className="mt-4 space-y-3">
      <FormField label="Repository to apply this practice to" htmlFor={fieldId} error={error ?? undefined}>
        <Select
          id={fieldId}
          value={repo}
          aria-label="Repository to apply this practice to"
          disabled={locked}
          onChange={(e) => {
            setRepo(e.target.value);
            setArtifact(null);
            setPr(null);
            setError(null);
          }}
        >
          {gapRepos.map((r) => (
            <option key={r.fullName} value={r.fullName}>
              {openPrByRepo.has(r.fullName) ? `${r.name} · PR open` : r.name}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="flex flex-wrap items-center gap-2">
        {livePr ? (
          <span className="text-slate-400">
            PR already open:{" "}
            <a href={livePr.prUrl} target="_blank" rel="noreferrer" className="text-slate-100 underline">
              #{livePr.prNumber}
            </a>
          </span>
        ) : (
          <>
            <GhostAction onClick={preview} disabled={locked}>
              {busy === "preview" ? "Generating…" : "Preview starter"}
            </GhostAction>
            {artifact && artifact.repo === repo && (
              <PrimaryAction onClick={apply} disabled={locked}>
                {busy === "apply" ? "Opening PR…" : "Open draft PR →"}
              </PrimaryAction>
            )}
          </>
        )}
      </div>
      {pr && (
        <p className="text-slate-200">
          {pr.reused ? "Existing draft PR: " : "Draft PR opened: "}
          <a href={pr.url} target="_blank" rel="noreferrer" className="text-slate-100 underline">
            {pr.url}
          </a>
        </p>
      )}
      {artifact && (
        <div>
          <PracticePreviewKicker shape={artifact.shape} />
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-slate-400 hover:text-slate-100">
            {open ? "▾" : "▸"} {artifact.path}
          </button>
          {open && (
            <pre className="mt-2 max-h-72 overflow-auto border border-divider p-3 font-mono type-mono-sm leading-relaxed text-slate-300">
              {artifact.body}
            </pre>
          )}
        </div>
      )}
      {gapRepos.length > 1 && (
        <PracticeApplyBatch
          org={org}
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
