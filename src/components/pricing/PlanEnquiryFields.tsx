"use client";

// The Custom-plan enquiry form's fields, extracted from PlanEnquiryCta so that file owns only the
// dialog + submit state machine. Purely presentational: one `draft` in, one `patch` out — the parent
// holds the state, so the same fields can be re-rendered disabled while a submit is in flight.
//
// Every control comes from the brand form kit (`@/components/ui` → Field / TextInput / SelectInput /
// TextArea / CheckCard). The first draft of this file hand-rolled its own `FIELD_LABEL` constant and
// input classes — copied from CreateIssueModal, which had copied them from nowhere — which is exactly
// the drift the kit exists to end. Nothing here sets a border or a background of its own.
//
// The five CheckCards are the SAME five adjustable areas the /pricing card advertises (ENQUIRY_AREAS),
// not a second hand-written list — a card that promises "hosting, scans, support, customization, SSO"
// and a form that asks about four of them is the kind of drift this module exists to prevent.

import { CheckCard, Field, SelectInput, TextArea, TextInput } from "@/components/ui";
import { ENQUIRY_AREAS, ENQUIRY_LIMITS, FLEET_SIZES, type EnquiryAreaId } from "@/lib/plan-enquiry";

export interface EnquiryDraft {
  name: string;
  email: string;
  company: string;
  fleetSize: string;
  areas: EnquiryAreaId[];
  message: string;
  /** Honeypot — rendered off-screen, never shown to a human, must stay empty (see the route). */
  website: string;
}

export const EMPTY_DRAFT: EnquiryDraft = {
  name: "",
  email: "",
  company: "",
  fleetSize: "",
  areas: [],
  message: "",
  website: "",
};

export function PlanEnquiryFields({
  draft,
  patch,
  disabled,
  invalidField,
}: {
  draft: EnquiryDraft;
  patch: (p: Partial<EnquiryDraft>) => void;
  disabled: boolean;
  /** Field the last validation rejected, so it can be marked. */
  invalidField: string | null;
}) {
  const toggleArea = (id: EnquiryAreaId) =>
    patch({ areas: draft.areas.includes(id) ? draft.areas.filter((a) => a !== id) : [...draft.areas, id] });

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" error={invalidField === "name" ? "Required" : null}>
          <TextInput
            name="name"
            autoComplete="name"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            disabled={disabled}
            maxLength={ENQUIRY_LIMITS.name.max}
            aria-invalid={invalidField === "name"}
          />
        </Field>
        <Field label="Work email" error={invalidField === "email" ? "Required" : null}>
          <TextInput
            name="email"
            type="email"
            autoComplete="email"
            value={draft.email}
            onChange={(e) => patch({ email: e.target.value })}
            disabled={disabled}
            maxLength={ENQUIRY_LIMITS.email.max}
            aria-invalid={invalidField === "email"}
          />
        </Field>
        <Field label="Company · optional">
          <TextInput
            name="company"
            autoComplete="organization"
            value={draft.company}
            onChange={(e) => patch({ company: e.target.value })}
            disabled={disabled}
            maxLength={ENQUIRY_LIMITS.company.max}
          />
        </Field>
        <Field label="Fleet size · optional">
          <SelectInput
            name="fleetSize"
            value={draft.fleetSize}
            onChange={(e) => patch({ fleetSize: e.target.value })}
            disabled={disabled}
          >
            <option value="">Not sure yet</option>
            {FLEET_SIZES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>

      <Field
        as="fieldset"
        label="What should we scope?"
        hint="Pick any that apply — it shapes what we come back with."
        className="mt-6"
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {ENQUIRY_AREAS.map((a) => (
            <CheckCard
              key={a.id}
              name="areas"
              checked={draft.areas.includes(a.id)}
              onChange={() => toggleArea(a.id)}
              disabled={disabled}
              label={a.label}
              hint={a.hint}
            />
          ))}
        </div>
      </Field>

      <Field
        label="What do you need?"
        error={invalidField === "message" ? "Tell us a little more" : null}
        className="mt-6"
      >
        <TextArea
          name="message"
          value={draft.message}
          onChange={(e) => patch({ message: e.target.value })}
          disabled={disabled}
          rows={5}
          maxLength={ENQUIRY_LIMITS.message.max}
          placeholder="Repos, teams, where inference has to run, the timeline you're working to…"
          aria-invalid={invalidField === "message"}
          className="text-sm"
        />
      </Field>

      {/* Honeypot: off-screen rather than display:none (some bots skip hidden inputs), never tabbable,
          and announced to nothing. A human cannot fill it; a form-filling bot fills every field. */}
      <input
        type="text"
        name="website"
        value={draft.website}
        onChange={(e) => patch({ website: e.target.value })}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />
    </>
  );
}
