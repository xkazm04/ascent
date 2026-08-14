// The Custom-plan enquiry mail — an OPERATOR-INBOUND message, the first of its kind here.
//
// Every other mail in this module is outbound to a user (a scan finished, you were invited, a repo
// regressed). This one runs the other way: a prospect fills the /pricing Custom form and the operator
// gets it. That flips two things.
//   - There is no unsubscribe. The recipient is the deployment's own sales address, configured in env,
//     and the message exists because someone asked to be contacted. `emailShell` still requires a
//     footer, so it says exactly that instead of pretending there's a list.
//   - `replyTo` is the point of the message. It carries the PROSPECT's address, so hitting Reply in the
//     operator's inbox answers the person, not the SES/Resend sender identity.
//
// The builder is PURE (no env, no Date, no I/O), same discipline as buildInviteEmail — the bytes an
// operator receives are pinned by unit tests. The address it's sent TO is resolved by the dispatcher.

import { areaLabel, fleetSizeLabel, type PlanEnquiryInput } from "@/lib/plan-enquiry";
import { dispatchBuiltEmail, type EmailDispatchResult } from "./index";
import { emailShell, escapeHtml, paragraph, preBlock } from "./render";

/** Where Custom-plan enquiries land. ASCENT_SALES_EMAIL overrides it per deployment; the default is
 *  the address this deployment's operator asked for, so the form works with no env at all. */
export const DEFAULT_SALES_EMAIL = "kazdanm@gmail.com";

/** The operator inbox for this deploy. */
export function salesEmail(): string {
  return process.env.ASCENT_SALES_EMAIL?.trim() || DEFAULT_SALES_EMAIL;
}

export interface PlanEnquiryEmailInput extends PlanEnquiryInput {
  /** GitHub login of the signed-in visitor, when there was one — a prospect we can already identify. */
  viewerLogin?: string | null;
  /** Org slug the visitor was browsing as, when resolvable. */
  orgSlug?: string | null;
}

/** `label: value` lines for the facts block, skipping anything the prospect didn't give us. Pure. */
function facts(input: PlanEnquiryEmailInput): [string, string][] {
  const rows: [string, string][] = [
    ["Name", input.name],
    ["Email", input.email],
  ];
  if (input.company) rows.push(["Company", input.company]);
  const fleet = fleetSizeLabel(input.fleetSize);
  if (fleet) rows.push(["Fleet", fleet]);
  if (input.areas.length) rows.push(["Wants scoped", input.areas.map(areaLabel).join(", ")]);
  if (input.viewerLogin) rows.push(["Signed in as", `@${input.viewerLogin}`]);
  if (input.orgSlug) rows.push(["Org", input.orgSlug]);
  return rows;
}

/**
 * Build the operator's enquiry mail. PURE. The subject leads with the company (falling back to the
 * person) so a full inbox sorts by who is asking, not by a repeated "Custom plan enquiry" prefix.
 */
export function buildPlanEnquiryEmail(input: PlanEnquiryEmailInput): { subject: string; html: string; text: string } {
  const who = input.company || input.name;
  const subject = `Custom plan enquiry — ${who}`;
  const rows = facts(input);

  const text = [
    `${who} asked about the Custom plan on Ascent.`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "What they need:",
    input.message,
    "",
    `Reply to this email to answer ${input.name} directly.`,
  ].join("\n");

  const factsHtml = `<table style="margin:0 0 16px;border-collapse:collapse;font-size:14px;color:#cbd5e1">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 14px 2px 0;color:#94a3b8;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:2px 0;vertical-align:top">${escapeHtml(v)}</td></tr>`,
    )
    .join("")}</table>`;

  const html = emailShell({
    heading: "Custom plan enquiry",
    bodyHtml: [paragraph(`${who} asked about the Custom plan.`), factsHtml, preBlock(input.message)].join(""),
    // The prospect's address is not a CTA button — mail clients wire Reply from replyTo, and a mailto:
    // button here would open a NEW thread that loses this message's contents.
    cta: null,
    footer: `Sent to the Ascent operator inbox because someone submitted the Custom plan form on /pricing. Reply to answer ${input.name} directly. Change the destination with ASCENT_SALES_EMAIL.`,
  });

  return { subject, html, text };
}

/**
 * Best-effort send of a Custom-plan enquiry to the operator inbox, with the prospect as reply-to.
 * NEVER throws — the enquiry is already persisted by the time this runs, so a provider outage must not
 * turn a stored lead into a 500 for the person who submitted it (the route reports `emailed: false`
 * instead, and the row is still there to work from).
 */
export async function dispatchPlanEnquiryEmail(input: PlanEnquiryEmailInput): Promise<EmailDispatchResult> {
  return dispatchBuiltEmail(salesEmail(), buildPlanEnquiryEmail(input), { replyTo: input.email });
}
