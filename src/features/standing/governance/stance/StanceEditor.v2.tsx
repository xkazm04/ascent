"use client";

// Prism editor for the org AI stance. Same hook as the Altimeter editor: draft upserts, publish
// bumps the version, and the form re-seeds from the server echo.
import { FormField, GhostAction, PrimaryAction, Textarea } from "@/components/kit";
import { useStanceEditor } from "./useStanceEditor";
import { StanceEditorReviewsV2 } from "./StanceEditorReviews.v2";
import { StanceEditorZonesV2 } from "./StanceEditorZones.v2";
import type { AiStance } from "@/lib/types";

export function StanceEditorV2({
  org,
  initial,
  nextVersion,
}: {
  org: string;
  initial: AiStance | null;
  nextVersion: number;
}) {
  const f = useStanceEditor(org, initial, nextVersion);
  return (
    <div className="mt-4 border-t border-divider pt-4">
      <p className="type-body-sm font-medium text-slate-100">Edit stance</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <FormField label="Permitted tools" htmlFor="gov-stance-tools" hint="One per line or comma-separated">
          <Textarea
            id="gov-stance-tools"
            value={f.tools}
            onChange={(e) => f.setTools(e.target.value)}
            rows={3}
            placeholder={"Claude Code\nCopilot"}
          />
        </FormField>
        <FormField label="Permitted models" htmlFor="gov-stance-models">
          <Textarea
            id="gov-stance-models"
            value={f.models}
            onChange={(e) => f.setModels(e.target.value)}
            rows={3}
            placeholder={"claude-opus\nclaude-sonnet"}
          />
        </FormField>
      </div>
      <StanceEditorZonesV2 zones={f.zones} onChange={f.setZone} onAdd={f.addZone} onRemove={f.removeZone} />
      <StanceEditorReviewsV2 reviews={f.reviews} onChange={f.setReview} />
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 type-body-sm text-slate-200">
          <input
            type="checkbox"
            checked={f.requireTrailer}
            onChange={(e) => f.setRequireTrailer(e.target.checked)}
            className="accent-accent"
          />
          Require attribution trailers on AI-assisted commits
        </label>
        <label className="flex items-center gap-2 type-body-sm text-slate-200">
          <input
            type="checkbox"
            checked={f.requireHumanApproval}
            onChange={(e) => f.setRequireHumanApproval(e.target.checked)}
            className="accent-accent"
          />
          Require a human approval on AI-attributed PRs
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3" aria-busy={f.busy !== null}>
        <GhostAction onClick={f.saveDraft} disabled={f.busy !== null}>
          {f.busy === "draft" ? "Saving…" : "Save draft"}
        </GhostAction>
        <PrimaryAction onClick={f.publish} disabled={f.busy !== null}>
          {f.busy === "publish" ? "Publishing…" : `Publish v${nextVersion}`}
        </PrimaryAction>
      </div>
      <div role="status" aria-live="polite" className="mt-3">
        <p className="type-body-sm text-slate-200">{f.msg ? (f.msg.kind === "error" ? `Error: ${f.msg.text}` : f.msg.text) : ""}</p>
      </div>
    </div>
  );
}
