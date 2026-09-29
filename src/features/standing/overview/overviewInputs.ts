// The Overview tab's resolved inputs, shared by both compositions so a period, scope or deep link can never
// resolve differently per theme. The scope is a PROMISE on purpose: both data regions await the same one
// (one query, two independently streaming boundaries), so it is deliberately NOT awaited here.
import { resolveOrgScope } from "@/lib/org/scope";
import { orgWindowBounds, resolveOrgWindow } from "@/lib/org/period";

export type OverviewSearchParams = { [key: string]: string | string[] | undefined };

export async function resolveOverviewInputs(slug: string, sp: OverviewSearchParams) {
  // An explicit ?range= wins (shareable links stay authoritative); otherwise the remembered period
  // cookie, then the default. Cookie-only, no database, so the period chrome never blocks.
  const period = await resolveOrgWindow(sp);
  // The one window shape the db layer queries with: half-open `{ start, endExclusive }`.
  const win = orgWindowBounds(period);
  // Segment + tech-stack scope still applies via deep links (?segment= / ?stack= carried from other tabs).
  const scope = resolveOrgScope(slug, sp);
  // `?dim=` seeds the heatmap's column sort; a bogus value is ignored downstream.
  const dimParam = typeof sp.dim === "string" ? sp.dim : undefined;
  // The tab's own query string (a server component has no useSearchParams), threaded into deep links so
  // they compose off the CURRENT scope rather than resetting it.
  const search = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : [])),
  ).toString();
  const stackQuery = typeof sp.stack === "string" ? `stack=${sp.stack}` : undefined;
  return { period, win, scope, dimParam, search, stackQuery };
}

export type OverviewInputs = Awaited<ReturnType<typeof resolveOverviewInputs>>;
