// The Custom-plan enquiry: what a prospect can tell us, and the ONE validator both ends run.
//
// The Custom tier (stored id `enterprise`, see src/lib/plans.ts) has no checkout — its price is
// "Flexible" because every line of it is scoped in a conversation. This module is the shape of that
// conversation's opening message: the five adjustable AREAS the /pricing card advertises, plus the
// free-text requirement. Kept PURE and client-safe (no env, no I/O, no server-only import) so the
// modal form and `POST /api/plan-enquiry` validate against the same rules — a field the client lets
// through and the server rejects (or vice versa) is a form that lies about what it accepts.
//
// `isEnquiryEmail` restates the conservative shape check from @/lib/email rather than importing it,
// for the same reason src/lib/alerts.ts does: that module reaches the email provider factory, and this
// one is imported by a client component.

/** The adjustable dimensions the Custom tier is scoped along — the same five the /pricing card lists,
 *  offered as checkboxes so an enquiry arrives already saying WHICH ones matter. Ids are stored. */
export const ENQUIRY_AREAS = [
  { id: "hosting", label: "Hosting", hint: "Shared cloud, your VPC, or on-prem" },
  { id: "scans", label: "Scan volume", hint: "Private scans per month across the fleet" },
  { id: "support", label: "Support & SLA", hint: "Response times, escalation, named contact" },
  { id: "customization", label: "App customization", hint: "Branding, custom dimensions, workflows" },
  { id: "sso", label: "SSO & directory", hint: "SAML/OIDC sign-in, SCIM provisioning" },
] as const;

export type EnquiryAreaId = (typeof ENQUIRY_AREAS)[number]["id"];

const AREA_IDS = new Set<string>(ENQUIRY_AREAS.map((a) => a.id));

/** Rough fleet size — the single number that most changes what a Custom quote looks like. Optional. */
export const FLEET_SIZES = [
  { id: "1-10", label: "1–10 repositories" },
  { id: "11-50", label: "11–50 repositories" },
  { id: "51-200", label: "51–200 repositories" },
  { id: "200+", label: "200+ repositories" },
] as const;

export type FleetSizeId = (typeof FLEET_SIZES)[number]["id"];

const FLEET_IDS = new Set<string>(FLEET_SIZES.map((f) => f.id));

/** Field bounds, exported so the form's `maxLength`/`required` attributes are the SAME numbers the
 *  server enforces instead of a second, drifting copy. */
export const ENQUIRY_LIMITS = {
  name: { min: 2, max: 120 },
  email: { max: 254 },
  company: { max: 160 },
  message: { min: 10, max: 4000 },
} as const;

/** A validated enquiry, ready to persist and to render into mail. */
export interface PlanEnquiryInput {
  name: string;
  email: string;
  /** Company / organization name as typed. Empty string when not given. */
  company: string;
  /** One of FLEET_SIZES ids, or "" when not chosen. */
  fleetSize: string;
  /** Selected ENQUIRY_AREAS ids, deduped and in catalog order. */
  areas: EnquiryAreaId[];
  message: string;
}

export type EnquiryValidation =
  | { ok: true; value: PlanEnquiryInput }
  | { ok: false; field: keyof PlanEnquiryInput; error: string };

/** Conservative email-shape check — enough to reject a typo before we try to reply to it. Mirrors
 *  isValidEmail in @/lib/email (restated to keep this module client-safe; see the header). */
export function isEnquiryEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= ENQUIRY_LIMITS.email.max;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Validate + normalize a raw enquiry payload (a parsed JSON body, or the form's own state). Returns the
 * FIRST failing field so the modal can focus it, rather than a list nobody reads. Over-long optional
 * fields are truncated rather than rejected — a pasted 300-char company name is not worth a red error —
 * but the two fields the whole message depends on (a replyable address, an actual requirement) are hard
 * failures.
 */
export function normalizePlanEnquiry(raw: unknown): EnquiryValidation {
  const o = (raw ?? {}) as Record<string, unknown>;

  const name = str(o.name);
  if (name.length < ENQUIRY_LIMITS.name.min) return { ok: false, field: "name", error: "Tell us who you are." };

  const email = str(o.email);
  if (!isEnquiryEmail(email)) return { ok: false, field: "email", error: "Enter an email we can reply to." };

  const message = str(o.message);
  if (message.length < ENQUIRY_LIMITS.message.min) {
    return { ok: false, field: "message", error: "Describe what you need: a sentence is enough." };
  }

  const rawAreas = Array.isArray(o.areas) ? o.areas : [];
  const picked = new Set(rawAreas.filter((a): a is string => typeof a === "string" && AREA_IDS.has(a)));
  // Catalog order, not submission order — the mail and the stored row read the same way every time.
  const areas = ENQUIRY_AREAS.filter((a) => picked.has(a.id)).map((a) => a.id);

  const fleetRaw = str(o.fleetSize);
  return {
    ok: true,
    value: {
      name: name.slice(0, ENQUIRY_LIMITS.name.max),
      email,
      company: str(o.company).slice(0, ENQUIRY_LIMITS.company.max),
      fleetSize: FLEET_IDS.has(fleetRaw) ? fleetRaw : "",
      areas,
      message: message.slice(0, ENQUIRY_LIMITS.message.max),
    },
  };
}

/** Human label for a stored area id (unknown ids pass through, so an older row never renders blank). */
export function areaLabel(id: string): string {
  return ENQUIRY_AREAS.find((a) => a.id === id)?.label ?? id;
}

/** Human label for a stored fleet-size id; "" when unset/unknown. */
export function fleetSizeLabel(id: string): string {
  return FLEET_SIZES.find((f) => f.id === id)?.label ?? "";
}
