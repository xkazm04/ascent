// Per-org SETTINGS that live as real columns on Organization — the storage half of two preferences that
// previously had nowhere proper to live. Mirrors src/lib/db/org-alerts.ts (the same resolve → guard →
// update shape) and is guarded by DATABASE_URL like the rest of the db layer.
//
//   • timezone         — the org's canonical calendar-day frame (G4-07). Resolution order is
//                        column → ASCENT_ORG_TZ → UTC, and it belongs to resolveOrgTimeZone, not to
//                        call sites (see src/lib/org/timezone.ts policy note 6).
//   • autoRechargeJson — the low-balance ("auto-recharge") preference (G1-39), moved out of the audit
//                        log. JSON in a TEXT column, matching this schema's no-jsonb DSQL contract.
//
// EVERYTHING GOES THROUGH THESE ACCESSORS. Both settings are read by more than one surface (the credits
// popover, the billing route, and the low-credit alert path), and a preference that several callers each
// parse for themselves is how the audit-log arrangement became load-bearing in the first place.

import type { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { getAuditLog } from "@/lib/db/scans-audit";
import { resolveOrgTimeZone } from "@/lib/org/timezone";
import {
  AUTO_RECHARGE_ACTION,
  DEFAULT_AUTO_RECHARGE,
  normalizeAutoRecharge,
  type AutoRechargePref,
} from "@/components/org/shared/CreditsControl.autorecharge";

/** Resolve the org, then apply a partial update to its row. False = persistence off / unknown org. */
async function updateOrgById(orgSlug: string, data: Prisma.OrganizationUpdateInput): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return false;
  await getPrisma().organization.update({ where: { id: orgId }, data });
  return true;
}

// ── Time zone (G4-07) ─────────────────────────────────────────────────────────────────────────────

/**
 * The org's RAW stored zone — the column, unresolved. null = never set (inherit the deployment
 * default), which is every org's state before it opts in. Use {@link getOrgTimeZone} for the value you
 * actually pass to the date primitives; this one is for the settings UI, which must be able to show
 * "inherited" distinctly from "explicitly set to UTC".
 */
export async function getOrgTimeZoneSetting(orgSlug: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const org = await getPrisma().organization.findUnique({
    where: { slug: orgSlug.toLowerCase() },
    select: { timezone: true },
  });
  return org?.timezone ?? null;
}

/**
 * The RESOLVED canonical zone for an org: its stored column when it names a zone this runtime knows,
 * else the deployment default (ASCENT_ORG_TZ, else UTC). Never throws and never returns an unusable
 * zone — a DB-less deployment, an unknown org, and a hand-edited garbage value all degrade to the
 * default rather than breaking a dashboard render. Pass the result as the `tz` argument of
 * dayKeyInZone / startOfDayInZone / parseDayKey / resolveWindow / …
 */
export async function getOrgTimeZone(orgSlug: string): Promise<string> {
  return resolveOrgTimeZone(await getOrgTimeZoneSetting(orgSlug).catch(() => null));
}

/**
 * Set (or clear, with null) the org's zone. Returns the stored value, or undefined when the org doesn't
 * exist. Storage only — an invalid zone is REJECTED here rather than stored and silently ignored on
 * read, because a settings form that accepts "Europe/Praha" and then behaves as UTC is worse than an
 * error. (The read path still degrades defensively; this is the belt to that's suspenders.)
 */
export async function setOrgTimeZone(orgSlug: string, tz: string | null): Promise<string | null | undefined> {
  const value = tz === null || tz.trim() === "" ? null : resolveTimeZoneForWrite(tz);
  if (value === undefined) return undefined;
  return (await updateOrgById(orgSlug, { timezone: value })) ? value : undefined;
}

/** null-or-valid, else undefined ("reject"). Kept separate so setOrgTimeZone reads as one decision. */
function resolveTimeZoneForWrite(tz: string): string | undefined {
  const trimmed = tz.trim();
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).resolvedOptions().timeZone ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

// ── Low-balance / auto-recharge preference (G1-39) ────────────────────────────────────────────────

/** Where a returned preference came from — `default` (never set), `column` (real storage), or `audit`
 *  (the legacy pre-migration row, still honored on read). The route surfaces stored-vs-default to the
 *  popover; the distinction between the two stored sources is for diagnosing the migration tail. */
export type AutoRechargeSource = "default" | "column" | "audit";

export interface StoredAutoRecharge {
  pref: AutoRechargePref;
  source: AutoRechargeSource;
}

/**
 * The org's low-balance preference. THE accessor — the credits popover, the billing route, and the
 * low-credit alert path all read through here rather than touching storage, so the fallback rule below
 * exists in exactly one place.
 *
 * READ ORDER, and why there are two sources: the preference used to be persisted as the most recent
 * `billing.autorecharge` AuditLog row. Migrating the column does NOT migrate that data (a SQL backfill
 * would have to parse JSON out of `AuditLog.meta` and pick the latest row per org — fragile, and it
 * would resurrect settings a purge may already have half-removed). So the column wins when set, and a
 * NULL column falls back to the legacy audit row, which keeps every existing customer's threshold
 * working with no migration step. The next PUT writes the column and the fallback stops being consulted
 * for that org.
 *
 * Best-effort in the safe direction: any read failure degrades to the DEFAULT (feature OFF). A transient
 * DB blip must not spontaneously arm a nag on a money surface.
 */
export async function getOrgAutoRecharge(orgSlug: string): Promise<StoredAutoRecharge> {
  const fallback: StoredAutoRecharge = { pref: { ...DEFAULT_AUTO_RECHARGE }, source: "default" };
  if (!isDbConfigured()) return fallback;

  const org = await getPrisma()
    .organization.findUnique({ where: { slug: orgSlug.toLowerCase() }, select: { autoRechargeJson: true } })
    .catch(() => null);
  const stored = parseAutoRecharge(org?.autoRechargeJson);
  if (stored) return { pref: stored, source: "column" };

  // Legacy tail: the pre-migration audit row. Same normalization, so a hand-edited/legacy blob degrades
  // to "feature off" instead of breaking the popover.
  const page = await getAuditLog(orgSlug, { action: AUTO_RECHARGE_ACTION, limit: 1 }).catch(() => null);
  const entry = page?.entries[0];
  return entry ? { pref: normalizeAutoRecharge(entry.meta), source: "audit" } : fallback;
}

/**
 * Persist the org's low-balance preference to the column. Returns false when persistence is off, the org
 * is unknown, or the write failed — and the caller MUST treat false as a failed SAVE (never report
 * success for a warning that was never armed).
 *
 * The audit row is NOT written here, deliberately: the caller still records `billing.autorecharge`
 * through the normal audit path, because "who changed this billing setting, and when" is a real audit
 * event. What changed in G1-39 is that the audit row is no longer the STORAGE.
 */
export async function setOrgAutoRecharge(orgSlug: string, pref: AutoRechargePref): Promise<boolean> {
  const normalized = normalizeAutoRecharge(pref);
  return updateOrgById(orgSlug, { autoRechargeJson: JSON.stringify(normalized) }).catch(() => false);
}

/** Parse the stored JSON blob; null when unset or unusable (→ the caller falls through to its default). */
function parseAutoRecharge(raw: string | null | undefined): AutoRechargePref | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return normalizeAutoRecharge(parsed);
  } catch {
    return null;
  }
}
