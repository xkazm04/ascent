// Persistence for Custom-plan enquiries (the /pricing form for the tier stored as `enterprise`).
//
// The ROW is the lead; the operator mail is a notification about it. So this write is NOT best-effort
// like the counter upserts in best-effort.ts — if it fails, the route says so, because a lead that was
// neither stored nor mailed must not be reported as received. `recordPlanEnquiryEmail` then stamps what
// happened to the notification, which is what makes "we have the lead but nobody was told" a visible
// state rather than an invisible one.
//
// Null / no-op when persistence is off, like the rest of src/lib/db — a deployment with no DATABASE_URL
// still sends the mail, it just has no durable copy.

import { getPrisma, isDbConfigured, withRetry } from "@/lib/db/client";
import type { PlanEnquiryInput } from "@/lib/plan-enquiry";

/** What became of the operator notification for a stored enquiry. */
export type EnquiryEmailStatus = "pending" | "sent" | "skipped" | "failed";

export interface StoredPlanEnquiry {
  id: string;
  createdAt: Date;
}

export interface PlanEnquiryRecord extends PlanEnquiryInput {
  /** Server-resolved, never from the request body. */
  viewerLogin?: string | null;
  orgSlug?: string | null;
}

/**
 * Store an enquiry. Returns null when persistence is off (the caller still mails it); THROWS on a real
 * write failure so the route can distinguish "no database here" from "the database rejected the lead".
 */
export async function createPlanEnquiry(input: PlanEnquiryRecord): Promise<StoredPlanEnquiry | null> {
  if (!isDbConfigured()) return null;
  const row = await withRetry(() =>
    getPrisma().planEnquiry.create({
      data: {
        plan: "enterprise",
        name: input.name,
        email: input.email,
        company: input.company,
        fleetSize: input.fleetSize,
        areasJson: JSON.stringify(input.areas),
        message: input.message,
        viewerLogin: input.viewerLogin ?? null,
        orgSlug: input.orgSlug ?? null,
      },
      select: { id: true, createdAt: true },
    }),
  );
  return { id: row.id, createdAt: row.createdAt };
}

/** Stamp the notification outcome on a stored enquiry. Best-effort: the lead is already durable, and
 *  failing the request over a status column would throw away a send that actually succeeded. */
export async function recordPlanEnquiryEmail(id: string, status: EnquiryEmailStatus): Promise<void> {
  if (!isDbConfigured()) return;
  try {
    await getPrisma().planEnquiry.update({ where: { id }, data: { emailStatus: status } });
  } catch {
    /* the enquiry itself is stored — a lost status stamp is not worth failing the response */
  }
}
