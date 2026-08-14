"use client";

// The Custom tier's CTA on /pricing: a button that opens the enquiry dialog, not a link.
//
// Pro and Team have a Polar product, so their CTA is a real checkout href. The Custom tier's price is
// "Flexible" precisely because it's scoped in a conversation — so its CTA has to START one. Previously
// it was a `mailto:` when ASCENT_CONTACT_EMAIL was set and "Learn more" → /about when it wasn't; on a
// deployment without that env, the highest-intent click on the pricing page went to a marketing page.
//
// This file owns the dialog + the submit state machine; the fields live in PlanEnquiryFields (on the
// shared brand form kit), and the validation is the SAME normalizePlanEnquiry the route runs
// (src/lib/plan-enquiry.ts) — so the button can't enable a submission the server will reject, and the
// error text is written once.

import { useState } from "react";
import { Kicker, Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui";
import { normalizePlanEnquiry } from "@/lib/plan-enquiry";
import { EMPTY_DRAFT, PlanEnquiryFields, type EnquiryDraft } from "./PlanEnquiryFields";

type Phase = "editing" | "sending" | "sent";

export function PlanEnquiryCta({ className, label = "Tell us what you need" }: { className: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<EnquiryDraft>(EMPTY_DRAFT);
  const [phase, setPhase] = useState<Phase>("editing");
  const [error, setError] = useState<{ message: string; field: string | null } | null>(null);

  const patch = (p: Partial<EnquiryDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setError(null);
  };

  // Closing a SENT dialog resets it, so re-opening offers a fresh form rather than a stale receipt.
  // Closing a half-typed one keeps the draft — a mis-click shouldn't cost someone their message.
  function close() {
    setOpen(false);
    if (phase === "sent") {
      setDraft(EMPTY_DRAFT);
      setPhase("editing");
    }
  }

  async function submit() {
    const parsed = normalizePlanEnquiry(draft);
    if (!parsed.ok) {
      setError({ message: parsed.error, field: parsed.field });
      return;
    }
    setPhase("sending");
    setError(null);
    try {
      const res = await fetch("/api/plan-enquiry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...parsed.value, website: draft.website }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; field?: string } | null;
      if (!res.ok) {
        setPhase("editing");
        setError({ message: data?.error ?? `Something went wrong (${res.status}).`, field: data?.field ?? null });
        return;
      }
      setPhase("sent");
    } catch {
      setPhase("editing");
      setError({ message: "Network error — check your connection and try again.", field: null });
    }
  }

  const sending = phase === "sending";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      <Modal open={open} onClose={close} locked={sending} ariaLabel="Enquire about the Custom plan" size="lg">
        <ModalHeader
          kicker="Plans · Custom"
          title={phase === "sent" ? "Thanks — we've got it" : "Scope your Custom plan"}
          context={phase === "sent" ? undefined : "Flexible · scoped with you"}
        />
        <ModalBody className="relative">
          {phase === "sent" ? <SentPanel email={draft.email} /> : (
            <>
              <p className="mb-5 text-sm leading-relaxed text-slate-400">
                Custom isn&apos;t a bigger tier — it&apos;s the same product with the parts that normally don&apos;t
                bend made adjustable. Tell us which ones matter and we&apos;ll come back with a shape and a price.
              </p>
              <PlanEnquiryFields draft={draft} patch={patch} disabled={sending} invalidField={error?.field ?? null} />
            </>
          )}
        </ModalBody>
        <ModalFooter>
          {error ? (
            <span role="alert" className="text-xs text-danger">
              {error.message}
            </span>
          ) : (
            <span className="text-xs text-slate-500">
              {phase === "sent"
                ? "No mailing list — this was a one-off message to us."
                : "Goes straight to us. We only use it to answer you."}
            </span>
          )}
          {phase === "sent" ? (
            <button
              type="button"
              onClick={close}
              className="focus-ring rounded-lg border border-divider px-4 py-2 font-mono text-sm text-slate-200 transition hover:border-accent hover:text-white"
            >
              Close
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={sending}
              className="focus-ring rounded-lg bg-accent px-4 py-2 font-mono text-sm font-semibold text-on-accent transition hover:bg-accent-soft disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send requirement"}
            </button>
          )}
        </ModalFooter>
      </Modal>
    </>
  );
}

/** The receipt. Deliberately a real confirmation panel rather than one grey sentence — this is the
 *  only moment the person gets told their message exists, and it names the address we'll answer at so
 *  a typo is still catchable while they're looking at it. */
function SentPanel({ email }: { email: string }) {
  return (
    <div className="py-2">
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-accent/50 bg-accent/10 text-lg text-accent"
        >
          ✓
        </span>
        <div className="min-w-0">
          <Kicker tone="muted">Received</Kicker>
          <p className="mt-1.5 text-base text-slate-200">
            We&apos;ll reply to <span className="font-mono text-white">{email}</span>.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            You&apos;ll get a shape for the pieces you flagged — where inference runs, the scan volume that fits your
            fleet, the support level, and what needs customizing.
          </p>
        </div>
      </div>
    </div>
  );
}
