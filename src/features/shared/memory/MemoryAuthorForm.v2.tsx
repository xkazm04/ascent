"use client";

// Prism write form. Same check-then-save path, same correction target, same button labels.
import { useEffect, useRef } from "react";
import { Caption, CellMark, FormField, GhostAction, Panel, PrimaryAction, Textarea } from "@/components/kit";
import { MemoryAuthorFieldsV2 } from "./MemoryAuthorFields.v2";
import { MemoryCheckV2 } from "./MemoryCheck.v2";
import type { CheckResponse } from "./memoryCheck";
import type { MemoryFormState } from "./MemoryTypes";
import type { MemoryRow } from "@/lib/db";
import { excerpt } from "./memoryView";

export function MemoryAuthorFormV2(props: {
  canWrite: boolean;
  planAllowed: boolean;
  kinds: readonly string[];
  namespaces: string[];
  form: MemoryFormState;
  setForm: (patch: Partial<MemoryFormState>) => void;
  busy: boolean;
  checking: boolean;
  verdict: CheckResponse | null;
  supersedeId: string | null;
  setSupersedeId: (id: string | null) => void;
  onCheck: () => void;
  onCancelCheck: () => void;
  onDismissVerdict: () => void;
  onSave: () => void;
  correcting: MemoryRow | null;
  onCancelCorrection: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const correctingId = props.correcting?.id ?? null;
  useEffect(() => {
    if (!correctingId) return;
    const field = contentRef.current?.querySelector("textarea");
    field?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    field?.focus({ preventScroll: true });
  }, [correctingId]);

  if (!props.canWrite) {
    return props.planAllowed ? null : (
      <p className="mt-5 border-t border-divider pt-4 type-body-sm text-slate-400">
        Writing to Shared Org Memory is a <span className="text-slate-200">Team-plan</span> feature. Members can read,
        search and recall everything the org already remembers.
      </p>
    );
  }

  const hasContent = props.form.content.trim().length > 0;
  const savingCorrection = Boolean(props.correcting && props.supersedeId === props.correcting.id);
  const saveLabel = props.busy ? "Saving…" : savingCorrection ? "Save correction" : props.supersedeId ? "Save & supersede" : "Save memory";

  return (
    <div className="mt-6 space-y-3 border-t border-divider pt-4">
      {props.correcting && (
        <Panel pad="sm" aria-label="Correcting">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="type-body-sm font-medium text-white">Correcting</p>
              <p className="mt-1">
                <CellMark state="missing">superseded on save</CellMark>
              </p>
              <p className="mt-1 type-body-sm text-slate-400 line-through">{excerpt(props.correcting.content, 140)}</p>
            </div>
            <GhostAction onClick={props.onCancelCorrection} disabled={props.busy}>
              Cancel
            </GhostAction>
          </div>
        </Panel>
      )}
      <FormField label="Memory content" htmlFor="mem-content">
        <div ref={contentRef}>
        <Textarea
          id="mem-content"
          value={props.form.content}
          onChange={(e) => props.setForm({ content: e.target.value })}
          placeholder="What should the org remember? e.g. “We chose Supabase GitHub OAuth over the custom flow; the custom one is dormant.”"
          rows={4}
          aria-label="Memory content"
        />
        </div>
      </FormField>
      <MemoryAuthorFieldsV2 kinds={props.kinds} namespaces={props.namespaces} form={props.form} setForm={props.setForm} />
      {props.verdict && (
        <MemoryCheckV2
          verdict={props.verdict}
          supersedeId={props.supersedeId}
          setSupersedeId={props.setSupersedeId}
          onDismiss={props.onDismissVerdict}
        />
      )}
      <Caption>
        A new write is checked against what is already stored, so a correction can replace the memory it fixes instead of
        sitting beside it. The check is a guardrail, never a gate: Save is always available.
      </Caption>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {props.checking ? (
          <GhostAction onClick={props.onCancelCheck}>Checking… cancel</GhostAction>
        ) : (
          <GhostAction onClick={props.onCheck} disabled={!hasContent || props.busy}>
            Check for duplicates
          </GhostAction>
        )}
        <PrimaryAction onClick={props.onSave} disabled={props.busy || props.checking || !hasContent}>
          {saveLabel}
        </PrimaryAction>
      </div>
    </div>
  );
}
