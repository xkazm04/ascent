// The share panel's preview, as a pure function of the pasted text, the developer's own consent
// choice and the view they are looking at.
//
// It runs the SERVER's door, unchanged: `validateCareShare` (the exact validator
// `POST /api/me/mentor/share` runs) and `careShareLedger` (the exact ledger the page renders after a
// push). Nothing is re-implemented here, so the browser refuses exactly what the route refuses, and it
// refuses before anything leaves the page.
//
// Two consent rules, both the developer's and nobody else's:
//   - The org-bands flag comes from the panel's checkbox, never from the file. A file saying yes is
//     reported (`fileConsent`) and stays out until the developer ticks the box; the body that leaves
//     carries their choice.
//   - A push REPLACES the stored share whole, so the preview names every section the developer stops
//     sharing by sending this one (`stopsSharing`).
//
// PURE module, no db import and no "use client": the panel is a client component.

import { CARE_SHARE_MAX_BYTES, validateCareShare, type CareSharePayload } from "@/lib/org/care-share-contract";
import { careShareLedger } from "@/lib/org/care-share-view";
import { validateCareShapePayload } from "@/lib/org/care-shape-contract";
import type { DeveloperView } from "@/lib/org/developer-view";

/** The sections a push can carry, as the developer reads them. */
export type CareShareSection = "profile" | "moves" | "journal" | "shape" | "consent";

export const CARE_SHARE_SECTION_LABEL: Record<CareShareSection, string> = {
  profile: "profile",
  moves: "moves",
  journal: "journal",
  shape: "session shape",
  consent: "anonymous org bands",
};

/** The route's own sentences, so the browser and the server say the same thing. */
export const careSharePreviewCopy = {
  invalid: "The share is not valid JSON.",
  tooLarge: `A share is at most ${CARE_SHARE_MAX_BYTES / 1024} KB.`,
  empty: "Paste a share or drop a share file. Nothing leaves this page until you commit.",
  replaces: "A share replaces your stored one whole: a section left out is no longer shared.",
  fileConsent: "Your file asks to join the anonymous org bands. It stays off until you tick the box.",
  fixture: "This is a preview fixture. Nothing on it can be shared or deleted.",
} as const;

export type CareSharePreview =
  | { state: "empty"; canCommit: false }
  | { state: "invalid"; errors: string[]; canCommit: false }
  | { state: "too-large"; bytes: number; canCommit: false }
  | { state: "refused"; errors: string[]; canCommit: false }
  | {
      state: "ready";
      canCommit: boolean;
      /** The exact text that will be POSTed. */
      body: string;
      share: CareSharePayload;
      ledger: DeveloperView["setup"]["sharing"];
      /** Ledger rows this share lights, by field name. */
      lights: string[];
      stopsSharing: CareShareSection[];
      counts: { profile: boolean; moves: number | null; journal: number | null; shapeFields: number | null };
      /** The developer's choice, as it will leave. */
      consent: boolean;
      /** What the FILE said, reported and never obeyed. */
      fileConsent: boolean;
    };

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The body that leaves: the pasted text untouched, unless the consent flag must carry the developer's choice. */
function bodyFor(text: string, raw: Record<string, unknown>, consent: boolean): string {
  if (!consent && raw.consent === undefined) return text;
  return JSON.stringify({ ...raw, consent: { orgAggregate: consent } });
}

/** Sections the stored share carries that this push leaves out. */
function stopsSharing(view: DeveloperView, share: CareSharePayload): CareShareSection[] {
  const out: CareShareSection[] = [];
  if (view.profile.sharedAt && !share.profile) out.push("profile");
  if (view.moves.length > 0 && !share.moves) out.push("moves");
  if (view.journal.length > 0 && !share.journal) out.push("journal");
  if (view.sharedFields.length > 0 && !share.shape) out.push("shape");
  const consenting = view.setup.sharing.some((r) => r.field === "Anonymous org bands" && r.shared);
  if (consenting && share.consent?.orgAggregate !== true) out.push("consent");
  return out;
}

/** Preview a pasted share against the developer's current view. `consent` is the panel's checkbox. */
export function careSharePreview(text: string, view: DeveloperView, consent = false): CareSharePreview {
  if (text.trim() === "") return { state: "empty", canCommit: false };
  const bytes = utf8Bytes(text);
  if (bytes > CARE_SHARE_MAX_BYTES) return { state: "too-large", bytes, canCommit: false };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { state: "invalid", errors: [careSharePreviewCopy.invalid], canCommit: false };
  }
  const asPasted = validateCareShare(raw);
  if (!asPasted.ok) return { state: "refused", errors: asPasted.errors, canCommit: false };

  const body = bodyFor(text, raw as Record<string, unknown>, consent);
  const outgoing = utf8Bytes(body);
  if (outgoing > CARE_SHARE_MAX_BYTES) return { state: "too-large", bytes: outgoing, canCommit: false };
  const leaving = validateCareShare(JSON.parse(body));
  if (!leaving.ok) return { state: "refused", errors: leaving.errors, canCommit: false };

  const share = leaving.share;
  const shape = share.shape ? validateCareShapePayload(share.shape) : null;
  const sharedFields = shape?.ok ? shape.sharedFields : [];
  const ledger = careShareLedger(share, sharedFields);
  return {
    state: "ready",
    canCommit: !view.demo,
    body,
    share,
    ledger,
    lights: ledger.filter((r) => r.shared).map((r) => r.field),
    stopsSharing: stopsSharing(view, share),
    counts: {
      profile: share.profile !== undefined,
      moves: share.moves?.length ?? null,
      journal: share.journal?.length ?? null,
      shapeFields: share.shape ? sharedFields.length : null,
    },
    consent,
    fileConsent: isObject(raw) && isObject(raw.consent) && raw.consent.orgAggregate === true,
  };
}

/** The "what leaves" line items, in reading order. */
export function careShareLeaves(p: Extract<CareSharePreview, { state: "ready" }>): string[] {
  const out: string[] = [];
  if (p.counts.profile) out.push("your profile (role, hint, goals)");
  if (p.counts.moves !== null) out.push(`${p.counts.moves} ${p.counts.moves === 1 ? "move" : "moves"}`);
  if (p.counts.journal !== null) out.push(`${p.counts.journal} journal ${p.counts.journal === 1 ? "entry" : "entries"}`);
  if (p.counts.shapeFields !== null) out.push(`${p.counts.shapeFields} session-shape ${p.counts.shapeFields === 1 ? "field" : "fields"}`);
  if (p.share.setup) out.push(`retro hook ${p.share.setup.hookInstalled ? "on" : "off"}`);
  if (p.consent) out.push("your shared values, into the anonymous org bands");
  return out;
}
