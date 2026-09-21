// LOCAL MODE — PREFLIGHT ONE TRANSPORT WITHOUT ARMING ANYTHING.
//
//   POST { org, transport, endpoint? } → { probe, refusal }
//
// `refusal` is the one sentence arming would show, or null when the probe passed. The route itself
// arms NOTHING and writes nothing: it exists so an operator can find out that the inference server
// is at 32 768 tokens BEFORE spending an overnight comparison run discovering it, and so the
// capability matrix has a door that does not cost a run.
//
// GUARDS, COPIED FROM THIS DIRECTORY'S NEIGHBOURS (autopilot/route.ts, drive/route.ts) RATHER THAN
// INVENTED: self-host 404 first (the surface does not exist on managed cloud — a local transport is
// not a thing a hosted deployment has), PUBLIC_ORG 403, then OWNER. Owner and not member, because
// the probe SPAWNS A SUBPROCESS with this deployment's environment and asks an operator-supplied
// URL a question from inside the server — the same blast radius the neighbouring writes have, even
// though nothing is armed.
//
// DELIBERATELY NOT GATED ON `autopilotEnabled()`. The neighbours 409 on it because they start
// editing agents; this route runs `--version` and `auth status` and reads three HTTP endpoints, and
// the operator who has not yet set ASCENT_AUTOPILOT=1 is exactly the one who needs to know whether
// the machine is ready.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { requireOrgRole } from "@/lib/authz";
import { selfHostGuard } from "@/lib/api/self-host";
import { normalizeModel, normalizeTransport } from "@/lib/local/arm";
import { probeRefusal, probeTransport } from "@/lib/local/transport/probe";
import type { LocalEndpoint } from "@/lib/local/transport/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

/**
 * The endpoint off the wire, or an error sentence.
 *
 * `http`/`https` ONLY, and the model goes through `normalizeModel` — the same regex the arm
 * validator applies, because this string reaches a re-parsing shell on the run this probe is about
 * to bless. `contextTokens` is the number the CLIENT will be told; it is validated as a positive
 * integer but is NOT what the context check reads, which is the server's own loaded figure.
 */
function parseEndpoint(v: unknown): { ok: true; endpoint: LocalEndpoint | null } | { ok: false; error: string } {
  if (v == null) return { ok: true, endpoint: null };
  if (typeof v !== "object") return { ok: false, error: "'endpoint' must be an object." };
  const o = v as Record<string, unknown>;
  const raw = typeof o.baseUrl === "string" ? o.baseUrl.trim() : "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "'endpoint.baseUrl' must be an absolute URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "'endpoint.baseUrl' must be http or https." };
  }
  const model = normalizeModel(o.model);
  if (!model) return { ok: false, error: "'endpoint.model' is missing or not a model token." };
  const contextTokens =
    typeof o.contextTokens === "number" && Number.isFinite(o.contextTokens) ? Math.trunc(o.contextTokens) : 0;
  if (contextTokens <= 0) return { ok: false, error: "'endpoint.contextTokens' must be a positive number." };
  const token = typeof o.token === "string" && o.token.trim() !== "" ? o.token.trim() : null;
  return { ok: true, endpoint: { baseUrl: url.toString().replace(/\/+$/, ""), model, token, contextTokens } };
}

export async function POST(request: Request) {
  const guard = selfHostGuard();
  if (guard) return guard;

  const body = (await request.json().catch(() => ({}))) as {
    org?: unknown;
    transport?: unknown;
    endpoint?: unknown;
  };
  const org = typeof body.org === "string" ? body.org.trim().toLowerCase() : "";
  if (!org) return bad("Missing 'org'.");
  if (org === PUBLIC_ORG) return NextResponse.json({ error: "The public funnel org has no transports." }, { status: 403 });
  const transport = normalizeTransport(body.transport);
  if (!transport) return bad("Missing or unknown 'transport'.");
  const endpoint = parseEndpoint(body.endpoint);
  if (!endpoint.ok) return bad(endpoint.error);

  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;

  const probe = await probeTransport(transport, endpoint.endpoint);
  return NextResponse.json({ probe, refusal: probeRefusal(probe) });
}
