"use client";

// Prism copy control. Same confirm, same apply route. The repo picker is a labeled Select.
import { useState } from "react";
import { ConfirmAction } from "@/components/ConfirmAction";
import { readApiResponse } from "./practiceApplyShared";
import { FormField, PrimaryAction, Select } from "@/components/kit";

export function RegistryPracticeApplyV2({
  org,
  slug,
  title,
  repoOptions,
}: {
  /** The dashboard org the apply is gated and audited under (not the repo owner). */
  org: string;
  slug: string;
  title: string;
  repoOptions: string[];
}) {
  const [repo, setRepo] = useState(repoOptions[0] ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pr, setPr] = useState<{ url: string; reused: boolean } | null>(null);
  if (repoOptions.length === 0) return null;

  const fieldId = `registry-copy-${slug}`;
  const label = `Repository to copy "${title}" into`;

  async function apply() {
    setBusy(true);
    setError(null);
    setPr(null);
    try {
      const res = await fetch("/api/practices/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, repo, practiceId: `registry:${slug}` }),
      });
      const read = await readApiResponse<{ url: string; reused?: boolean }>(res, "Failed to open the PR.");
      if (!read.ok) throw new Error(read.error);
      setPr({ url: read.data.url, reused: !!read.data.reused });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open the PR.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <FormField className="min-w-[12rem] flex-1" label={label} htmlFor={fieldId} error={error ?? undefined}>
          <Select
            id={fieldId}
            value={repo}
            aria-label={label}
            onChange={(e) => setRepo(e.target.value)}
          >
            {repoOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </FormField>
        <PrimaryAction onClick={() => setConfirming(true)} disabled={busy || !repo}>
          {busy ? "Opening…" : "Copy into a repo →"}
        </PrimaryAction>
      </div>
      {pr && (
        <a href={pr.url} target="_blank" rel="noreferrer" className="text-slate-100 underline">
          {pr.reused ? "Existing draft PR" : "Draft PR opened"}
        </a>
      )}
      <ConfirmAction
        open={confirming}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void apply();
        }}
        kicker="Registry practice"
        title={`Copy "${title}" into ${repo}?`}
        body={`This opens a draft pull request in ${repo} committing a COPY of your registry's practice at docs/practices/${slug}.md. The registry keeps the source of truth: this copy is for reference in that repo, and editing it there will not change the registry.`}
        confirmLabel="Open draft PR"
        tone="default"
      />
    </div>
  );
}
