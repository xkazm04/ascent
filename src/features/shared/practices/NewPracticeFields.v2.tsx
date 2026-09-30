"use client";

// Labeled fields for the Prism new-practice dialog. Ids match the labels; values stay controlled.
import { FormField, Input, Select, Textarea } from "@/components/kit";
import { PLAYBOOK_TEMPLATES } from "@/lib/org/playbook-templates";

export function NewPracticeFieldsV2({
  title,
  dimId,
  summary,
  stepsText,
  dimOptions,
  error,
  onTitle,
  onDim,
  onSummary,
  onSteps,
  onTemplate,
}: {
  title: string;
  dimId: string;
  summary: string;
  stepsText: string;
  dimOptions: { id: string; label: string }[];
  error: string | null;
  onTitle: (v: string) => void;
  onDim: (v: string) => void;
  onSummary: (v: string) => void;
  onSteps: (v: string) => void;
  onTemplate: (index: number) => void;
}) {
  return (
    <div className="space-y-3">
      <FormField label="Start from a template" htmlFor="np-template">
        <Select
          id="np-template"
          value=""
          aria-label="Start from a template"
          onChange={(e) => e.target.value !== "" && onTemplate(Number(e.target.value))}
        >
          <option value="">choose a template…</option>
          {PLAYBOOK_TEMPLATES.map((t, i) => (
            <option key={t.title} value={i}>
              {t.dimId} · {t.title}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Playbook title" htmlFor="np-title">
          <Input
            id="np-title"
            value={title}
            aria-label="Playbook title"
            placeholder="e.g. Our CI standard"
            onChange={(e) => onTitle(e.target.value)}
          />
        </FormField>
        <FormField label="Dimension" htmlFor="np-dim">
          <Select id="np-dim" value={dimId} aria-label="Dimension" onChange={(e) => onDim(e.target.value)}>
            {dimOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id} · {d.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField label="Summary (optional)" htmlFor="np-summary">
        <Input
          id="np-summary"
          value={summary}
          aria-label="Summary (optional)"
          placeholder="What it is / why it matters (optional)"
          onChange={(e) => onSummary(e.target.value)}
        />
      </FormField>
      <FormField label="Steps, one per line (optional)" htmlFor="np-steps">
        <Textarea
          id="np-steps"
          value={stepsText}
          aria-label="Steps, one per line (optional)"
          placeholder="Steps, one per line (optional)"
          rows={4}
          onChange={(e) => onSteps(e.target.value)}
        />
      </FormField>
      {error && (
        <p role="alert" className="type-note text-slate-100">
          <span aria-hidden>! </span>
          {error}
        </p>
      )}
    </div>
  );
}
