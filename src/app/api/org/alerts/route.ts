// GET  /api/org/alerts?org=slug                                  -> { webhookUrl, overallDrop, dimensionDrop }  (admin)
// GET  /api/org/alerts?org=slug&movement=1                       -> { movement }          (member) scan-memory ∪ control-failed AlertEvents since watermark
// GET  /api/org/alerts?org=slug&history=1                        -> { events, health }    (member) recent alert dispatches (AlertEvent) + sink health
// POST /api/org/alerts { org, webhookUrl?, overallDrop?, dimensionDrop? } -> { ok, ... }  (admin)  set/clear sink + thresholds
// POST /api/org/alerts { org, test: true }                       -> { ok, delivered }     (admin)  send a test alert
// POST /api/org/alerts { org, resend: eventId }                  -> { ok, delivered }     (admin)  re-send an undelivered alert's stored text
// POST /api/org/alerts { org, seen: true }                       -> { ok, seen }          (member) advance the viewer's watermark
//
// Per-org alert sink configuration — where regression alerts, low-credit pushes and the weekly
// digest for this org are POSTed (Slack-compatible incoming webhook). Setting it routes the org's
// fleet intelligence to its OWN channel instead of the operator's global ALERT_WEBHOOK_URL; clearing
// it (webhookUrl: null or "") falls back to the global sink (or a clean no-op when that's unset).
// Admin-gated in BOTH directions: an incoming-webhook URL is a channel-posting secret, so reads are
// as sensitive as writes.

import { NextResponse } from "next/server";
import {
  getAlertsWatermark,
  getOrgAlertThresholds,
  getOrgAlertWebhook,
  getOrgMovementSince,
  isDbConfigured,
  listAlertEvents,
  markAlertsSeen,
  recordOrgAudit,
  setOrgAlertThresholds,
  setOrgAlertWebhook,
  type AlertEventInput,
  type AlertEventKind,
} from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { requireSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { buildTestAlertMessage, validateAlertWebhookUrl } from "@/lib/alerts";
import { deliverAlert, type SinkRead } from "@/lib/alert-door";
import { getAlertEventForResend } from "@/lib/db/alert-events";
import { isResendable, sinkHealth, toHistoryEvent } from "@/lib/alert-sink-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Parse a threshold field: a positive integer (1..100), or null when explicitly blank/null (which
 * CLEARS the override back to DEFAULT_THRESHOLDS). `false` = invalid, `undefined` = the key was not
 * present in the body at all.
 *
 * The absent case is NOT the same as the blank case, and conflating them was a silent data loss: the
 * route advertises both threshold fields as optional and gates on `"overallDrop" in body || ...`, so
 * `POST { org, overallDrop: 7 }` is a documented one-sided update — and it used to reset the caller's
 * dimensionDrop to the default on its way through, because `undefined` parsed to the same `null` a
 * deliberate clear does. Only the popover, which always sends both fields, hid it.
 */
function parseThreshold(v: unknown): number | null | false | undefined {
  if (v === undefined) return undefined; // key absent — leave the stored value alone
  if (v === null || v === "") return null; // explicit clear — back to the default
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 100) return false;
  return n;
}

/** Rows read for sink health (a failing streak can outlast the drawer), and rows the drawer lists. */
const HEALTH_WINDOW = 100;
const HISTORY_ROWS = 30;

/** Copy for a send the door reported undelivered, by its outcome. No em dashes: users read these. */
function undeliveredError(outcome: string | null, candidate = false): string {
  if (candidate) return "Couldn't deliver to that webhook URL. Check it's a live incoming webhook.";
  if (outcome === "sink-unreadable") return "Couldn't read this organization's alert sink. Try again in a moment.";
  if (outcome === "no-sink") return "No alert sink is configured (set a webhook, or the global ALERT_WEBHOOK_URL).";
  return "Couldn't deliver to the configured alert sink.";
}

/**
 * Admin resend of one undelivered alert (fleet-alerts-digests#B). A failed weekly digest used to be
 * lost for the week: its claim is released "so the next run retries", but the next run is seven days
 * later in a new window. Gate-then-constrain: the caller is already admin-gated on `org`, and the
 * row is looked up by id AND that org, so another org's id is a plain 404. The stored plain text is a
 * complete payload for both channel kinds (a `mailto:` sink renders from text alone). It goes out
 * through the one delivery door, so the attempt is a NEW history row; the original row is untouched.
 */
async function resendResponse(org: string, id: string): Promise<NextResponse> {
  const row = await getAlertEventForResend(org, id).catch(() => undefined);
  if (row === undefined) return NextResponse.json({ error: "Couldn't read the alert history." }, { status: 500 });
  if (!row) return NextResponse.json({ error: "No such alert in this organization." }, { status: 404 });
  if (!isResendable(row)) {
    return NextResponse.json(
      { error: "This alert can't be resent: it was delivered, held back on purpose, or its stored text was cut off." },
      { status: 409 },
    );
  }
  const text = `Resent by an admin. First raised ${row.createdAt.slice(0, 10)}.\n\n${row.body}`;
  const out = await deliverAlert({
    org,
    kind: row.kind as AlertEventKind,
    severity: row.severity as AlertEventInput["severity"],
    title: row.title,
    repoFullName: row.repoFullName,
    build: () => ({ text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] }),
  });
  const actorLogin = await resolveViewerLogin();
  await recordOrgAudit(
    "org.alerts.resend",
    org,
    { eventId: row.id, kind: row.kind, delivered: out.delivered },
    actorLogin ?? undefined,
  ).catch(() => {});
  return NextResponse.json({ ok: true, delivered: out.delivered, ...(out.delivered ? {} : { error: undeliveredError(out.outcome) }) });
}

/**
 * "What moved since you last looked" — the Alerts chip's movement count, measured from this
 * viewer's own Membership watermark. Split from the config read on purpose: the config payload
 * carries a channel-posting secret (admin-only, loaded lazily on open), while the count renders on
 * page load for any member.
 *
 * `getOrgMovementSince` unions scan-fed Shared Org Memory with control-failed AlertEvent rows in
 * the same window. A control flip is ledger-sourced and never a memory row, so memory-only counting
 * left the badge silent after branch protection came off. The route does not re-filter: whatever
 * the reader returns is serialized as-is.
 *
 * Every degraded path answers `{ movement: null }`, which the chip renders exactly as it did before
 * this feature existed: auth-off deployments and the public org (no viewer identity), a viewer with
 * no membership row (no per-user watermark to measure from), and any read failure.
 */
async function movementResponse(org: string): Promise<NextResponse> {
  const denied = await requireOrgRole(org, "viewer");
  if (denied) return denied;
  try {
    const login = await resolveViewerLogin();
    if (!login) return NextResponse.json({ movement: null });
    const watermark = await getAlertsWatermark(org, login);
    if (!watermark) return NextResponse.json({ movement: null });
    const movement = await getOrgMovementSince(org, watermark.since);
    if (!movement) return NextResponse.json({ movement: null });
    return NextResponse.json({
      movement: {
        since: movement.since.toISOString(),
        firstLook: !watermark.hadWatermark,
        count: movement.count,
        capped: movement.capped,
        items: movement.items.map((i) => ({
          repo: i.repo,
          event: i.event,
          summary: i.summary,
          at: i.at.toISOString(),
        })),
      },
    });
  } catch (err) {
    // A chip decoration must never turn an org page into an error: fall back to the countless chip.
    console.error("[api/org/alerts] movement read failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ movement: null });
  }
}

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Alert routing requires a database." }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const org = params.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  // Movement is a separate, member-readable payload — resolved BEFORE the admin gate below.
  if (params.get("movement") === "1") return movementResponse(org);
  // Alert history — member-readable like movement (rows carry titles and outcomes, never the sink
  // URL), resolved BEFORE the admin gate. Degrades to { events: [] } on any read failure: a drawer
  // section must never error the popover.
  if (params.get("history") === "1") {
    const deniedHistory = await requireOrgRole(org, "viewer");
    if (deniedHistory) return deniedHistory;
    // Health is read over a wider window than the drawer lists, and is null (unknown) when the read
    // failed: "we could not tell" must not render as "no alert was ever attempted".
    const rows = await listAlertEvents(org, HEALTH_WINDOW).catch(() => null);
    if (!rows) return NextResponse.json({ events: [], health: null });
    return NextResponse.json({
      events: rows.slice(0, HISTORY_ROWS).map(toHistoryEvent),
      health: sinkHealth(rows, { windowFull: rows.length >= HEALTH_WINDOW }),
    });
  }
  const denied = await requireOrgRole(org, "admin");
  if (denied) return denied;
  const [webhookUrl, thresholds] = await Promise.all([getOrgAlertWebhook(org), getOrgAlertThresholds(org)]);
  return NextResponse.json({ webhookUrl, overallDrop: thresholds.overallDrop, dimensionDrop: thresholds.dimensionDrop });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Alert routing requires a database." }, { status: 503 });
  // CSRF defense-in-depth, matching the credit-grant mutation (the session cookie is SameSite=Lax).
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    webhookUrl?: unknown;
    overallDrop?: unknown;
    dimensionDrop?: unknown;
    test?: boolean;
    seen?: boolean;
    resend?: unknown;
  };
  if (!body.org) return NextResponse.json({ error: "Provide { org, webhookUrl }." }, { status: 400 });

  // Watermark advance ("I've now looked at what moved"). Member-gated, not admin-gated — reading your
  // own fleet's movement is not a privileged action, and the stamp lands on the CALLER's own
  // Membership row, so it can't touch anyone else's read state. Handled before the admin gate below.
  if (body.seen === true) {
    const deniedSeen = await requireOrgRole(body.org, "viewer");
    if (deniedSeen) return deniedSeen;
    const login = await resolveViewerLogin();
    // No viewer identity (auth-off / public org) → nothing to stamp; a clean no-op, not an error.
    if (!login) return NextResponse.json({ ok: true, seen: false });
    const at = new Date();
    const stamped = await markAlertsSeen(body.org, login, at).catch(() => false);
    return NextResponse.json({ ok: true, seen: stamped, ...(stamped ? { seenAt: at.toISOString() } : {}) });
  }

  const denied = await requireOrgRole(body.org, "admin");
  if (denied) return denied;

  if (body.resend !== undefined) {
    if (typeof body.resend !== "string" || body.resend === "") {
      return NextResponse.json({ error: "resend must be an alert event id." }, { status: 400 });
    }
    return resendResponse(body.org, body.resend);
  }

  // Test-send: the popover's whole job is to validate the CANDIDATE webhook the admin is still
  // editing, so when the request carries a non-empty `webhookUrl` we validate it and dispatch to
  // THAT url — not the previously-stored sink (which would falsely report a typo'd new URL as
  // "delivered ✓" via a stored/global fallback). A blank field still tests the org's resolved sink.
  if (body.test === true) {
    const org = body.org;
    let sink: SinkRead | undefined;
    let candidate = false;
    if (typeof body.webhookUrl === "string" && body.webhookUrl.trim() !== "") {
      const v = validateAlertWebhookUrl(body.webhookUrl);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      sink = { ok: true, value: v.url };
      candidate = true;
    }
    // Through the one alert door, like every other kind, so the test lands in the same AlertEvent
    // ledger (kind `test`): the history is then also the channel's health record, and a test that
    // failed says so there. Without a candidate the door reads the org's stored sink itself.
    // `org` is not decoration on the dispatch. For a `mailto:` sink it is what mints the unsubscribe
    // link and names the tenant in the "why am I receiving this" line (see email/alert-sink.ts);
    // without it the ONE mail an admin sends to verify their email sink is the one mail with neither.
    const out = await deliverAlert({
      org,
      sink,
      kind: "test",
      severity: "info",
      title: candidate ? "Test alert (unsaved webhook)" : "Test alert",
      build: () => buildTestAlertMessage(org),
    });
    const delivered = out.delivered;
    return NextResponse.json({
      ok: true,
      delivered,
      ...(delivered ? {} : { error: undeliveredError(out.outcome, candidate) }),
    });
  }

  const hasWebhook = "webhookUrl" in body;
  const hasThresholds = "overallDrop" in body || "dimensionDrop" in body;
  if (!hasWebhook && !hasThresholds) {
    return NextResponse.json({ error: "Provide webhookUrl and/or overallDrop/dimensionDrop." }, { status: 400 });
  }

  // resolveViewerLogin, not getSession: the dormant custom-OAuth session is null under the ACTIVE
  // Supabase wall, so this audit row recorded a null actor in production.
  const actorLogin = await resolveViewerLogin();
  const result: { ok: true; webhookUrl?: string | null; overallDrop?: number | null; dimensionDrop?: number | null } = { ok: true };

  // Webhook: null / "" clears the override (fall back to the global sink); anything else must validate.
  if (hasWebhook) {
    let url: string | null = null;
    if (typeof body.webhookUrl === "string" && body.webhookUrl.trim() !== "") {
      const v = validateAlertWebhookUrl(body.webhookUrl);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      url = v.url;
    } else if (body.webhookUrl != null && typeof body.webhookUrl !== "string") {
      return NextResponse.json({ error: "webhookUrl must be a string or null." }, { status: 400 });
    }
    const stored = await setOrgAlertWebhook(body.org, url);
    if (stored === undefined) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
    result.webhookUrl = stored;
    // SEC #1: actor goes in the dedicated `actorId` column so the viewer/filter can surface it.
    await recordOrgAudit(
      "org.alerts.webhook",
      body.org,
      { org: body.org, action: url ? "set" : "cleared" },
      actorLogin ?? undefined,
    ).catch(() => {});
  }

  // Regression thresholds: null clears a field back to DEFAULT_THRESHOLDS; a positive int 1..100 sets it.
  if (hasThresholds) {
    const parsedOverall = parseThreshold(body.overallDrop);
    const parsedDimension = parseThreshold(body.dimensionDrop);
    if (parsedOverall === false || parsedDimension === false) {
      return NextResponse.json({ error: "overallDrop/dimensionDrop must be an integer 1..100 or null." }, { status: 400 });
    }
    // A field the caller did not send keeps whatever is stored — read it back rather than writing a
    // null over it. Both present (the popover's only shape) skips the read entirely.
    const current =
      parsedOverall === undefined || parsedDimension === undefined ? await getOrgAlertThresholds(body.org) : null;
    const overallDrop = parsedOverall === undefined ? (current?.overallDrop ?? null) : parsedOverall;
    const dimensionDrop = parsedDimension === undefined ? (current?.dimensionDrop ?? null) : parsedDimension;
    const stored = await setOrgAlertThresholds(body.org, { overallDrop, dimensionDrop });
    if (stored === undefined) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
    result.overallDrop = stored.overallDrop;
    result.dimensionDrop = stored.dimensionDrop;
    // SEC #1: actor goes in the dedicated `actorId` column so the viewer/filter can surface it.
    await recordOrgAudit(
      "org.alerts.thresholds",
      body.org,
      { org: body.org, overallDrop, dimensionDrop },
      actorLogin ?? undefined,
    ).catch(() => {});
  }

  return NextResponse.json(result);
}
