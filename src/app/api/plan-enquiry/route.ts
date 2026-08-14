// POST /api/plan-enquiry — the Custom tier's substitute for a checkout.
//
// Pro and Team have a Polar product to buy; the Custom tier (stored id `enterprise`, see src/lib/plans.ts)
// has a conversation instead, and this is where it starts. Before this route the card's CTA was a
// `mailto:` when ASCENT_CONTACT_EMAIL happened to be set and a link to /about when it wasn't — so on this
// deployment the most valuable lead on the pricing page had nowhere at all to go.
//
// ORDER MATTERS: store, then notify. The row is the lead; the operator mail is a notification about it.
// Mailing first and storing second would mean a DB hiccup silently discards a prospect whose message is
// already gone from their browser. So the response reports `stored` and `emailed` separately, and only a
// case where BOTH failed is an error the submitter is told about.
//
// GUARDS, outermost first: same-origin (this is a browser form, never an API), rate limit (an
// unauthenticated endpoint that sends mail is a spam cannon aimed at one inbox — see CONTACT_RATE_LIMIT),
// honeypot, then validation shared with the form itself (src/lib/plan-enquiry.ts).

import { NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/auth";
import { getViewer } from "@/lib/access";
import { isDbConfigured, listOrgsForLogin } from "@/lib/db";
import { createPlanEnquiry, recordPlanEnquiryEmail } from "@/lib/db/plan-enquiry";
import { dispatchPlanEnquiryEmail } from "@/lib/email/plan-enquiry";
import { normalizePlanEnquiry } from "@/lib/plan-enquiry";
import { CONTACT_RATE_LIMIT, rateLimitRequestShared, tooManyRequests } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The hidden field a human never sees and a naive bot always fills. A filled honeypot is answered with
 *  the SAME shape a real submission gets — telling a spammer it was detected only teaches it to stop
 *  filling the field. Nothing is stored and no mail is sent. */
const HONEYPOT_FIELD = "website";

export async function POST(request: Request) {
  const xo = requireSameOrigin(request);
  if (xo) return xo;

  const rl = await rateLimitRequestShared(request, CONTACT_RATE_LIMIT);
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  if (typeof raw[HONEYPOT_FIELD] === "string" && raw[HONEYPOT_FIELD].trim() !== "") {
    return NextResponse.json({ ok: true, stored: false, emailed: false });
  }

  const parsed = normalizePlanEnquiry(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
  }
  const enquiry = parsed.value;

  // Identity is resolved SERVER-side and only decorates the lead — a signed-in prospect who already
  // runs an org is worth knowing about, but nothing here is gated on it and the body can't claim a
  // login or an org it doesn't have. Both reads are optional: a failure just means a thinner lead.
  const viewer = await getViewer().catch(() => null);
  const login = viewer?.login ?? null;
  const orgSlug =
    login && isDbConfigured() ? await listOrgsForLogin(login).then((o) => o[0]?.slug ?? null).catch(() => null) : null;
  const context = { viewerLogin: login, orgSlug };

  let storedId: string | null = null;
  let storeFailed = false;
  try {
    const stored = await createPlanEnquiry({ ...enquiry, ...context });
    storedId = stored?.id ?? null;
  } catch (err) {
    // Not fatal on its own: the mail below may still reach the operator, which is the outcome the
    // submitter actually cares about. Logged loudly because a lead with no durable copy is a real loss.
    storeFailed = true;
    console.error("[plan-enquiry] persist failed", err instanceof Error ? err.message : err);
  }

  const sent = await dispatchPlanEnquiryEmail({ ...enquiry, ...context });
  if (storedId) await recordPlanEnquiryEmail(storedId, sent.skipped ? "skipped" : sent.ok ? "sent" : "failed");

  const emailed = sent.ok && !sent.skipped;
  // Nothing durable and nobody notified — the only case where "we got it" would be a lie.
  if (!storedId && !emailed) {
    return NextResponse.json(
      { error: "We couldn't record your enquiry. Please email us directly and we'll pick it up." },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, stored: Boolean(storedId), emailed, storeFailed });
}
