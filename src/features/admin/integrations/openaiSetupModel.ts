// Pure copy + parsing for the OpenAI connect surface (OpenAISetup.tsx). No hooks and no JSX, so
// deliberately NO "use client": the panel and its test import it.

import type { ProviderConnectionRow } from "@/lib/db/provider-credentials";

/** The sync route's body: a success summary, or `{ error }`. */
export interface OpenAISyncBody {
  synced?: boolean;
  days?: number;
  costCents?: number;
  stored?: number;
  partial?: boolean;
  partialReason?: string;
  from?: string | null;
  through?: string | null;
  skippedNonUsd?: number;
  note?: string;
  error?: string;
}

/** "proj_a, proj_b\nproj_c" → ids. Validation is the route's job; this only splits. */
export function parseProjectIds(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** An ISO instant → its UTC day. `exclusiveEnd` names the day BEFORE it (a bucket end is exclusive). */
export function utcDay(iso: string | null | undefined, exclusiveEnd = false): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(exclusiveEnd ? ms - 86_400_000 : ms).toISOString().slice(0, 10);
}

function span(from: string | null | undefined, through: string | null | undefined): string {
  const a = utcDay(from);
  const b = utcDay(through, true);
  return a && b ? ` covering ${a} to ${b}` : "";
}

export function syncSummaryLine(d: OpenAISyncBody): string {
  const days = d.days ?? 0;
  const stored = d.stored ?? 0;
  return (
    `Synced ${days} day${days === 1 ? "" : "s"} of OpenAI cost (${stored} record${stored === 1 ? "" : "s"} stored): ` +
    `${usd(d.costCents ?? 0)}${span(d.from, d.through)}.`
  );
}

/** The persisted last-sync line. A partial sync says so and why; it never reads as a whole window. */
export function lastSyncLine(row: ProviderConnectionRow | null): { text: string; tone: "ok" | "warn" } | null {
  if (!row?.lastSyncAt || !row.lastSyncStatus) return null;
  const when = utcDay(row.lastSyncAt);
  if (row.lastSyncStatus === "complete") {
    return { text: `Last sync ${when}: complete${span(row.lastSyncFrom, row.lastSyncThrough)}.`, tone: "ok" };
  }
  const label = row.lastSyncStatus === "partial" ? "PARTIAL" : "failed";
  return {
    text: `Last sync ${when}: ${label}${span(row.lastSyncFrom, row.lastSyncThrough)}. ${row.lastSyncDetail ?? ""}`.trim(),
    tone: "warn",
  };
}

/** What an owner should DO about each refusal. The route's own sentence stays the headline. */
export function remedyFor(status: number): string | null {
  switch (status) {
    case 400:
      return "Create an Admin key in OpenAI under Organization settings, Admin keys. Project and service-account keys cannot read costs.";
    case 403:
      return "Only an organization Admin key can read the Costs API. Save one above, then sync again.";
    case 409:
      return "Save the OpenAI admin key above, then sync again.";
    case 429:
      return "OpenAI throttled the Costs API. Wait a minute and sync again; nothing was stored.";
    case 502:
      return "Nothing was stored, so a later sync will pick the window up whole. Try again shortly.";
    case 503:
      return "This is a deployment-level gap, not an organization one: an operator has to configure the database on this instance.";
    default:
      return null;
  }
}
