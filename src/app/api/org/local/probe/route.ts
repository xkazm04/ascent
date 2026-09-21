// LOCAL MODE — PREFLIGHT THE WHOLE ARM SET WITHOUT ARMING ANYTHING.
//
//   POST { org, arms, armPolicy? } → { arms: ArmVerdict[], probes: ProbeResult[], refusal }
//
// `refusal` is the one sentence arming would show, or null when every arm passed. The route itself
// arms NOTHING and writes nothing: it exists so an operator can find out that the inference server
// is at 32 768 tokens BEFORE spending an overnight comparison run discovering it, and so the
// capability matrix has a door that does not cost a run.
//
// ── WHY THE BODY CARRIES ARMS AND NOT A TRANSPORT ────────────────────────────────────────────────
//
// It used to take `{ transport, endpoint? }`, and the cockpit — correctly — sent no endpoint, because
// a base URL typed in a browser would be a second answer to a question the deployment already
// answers. But an endpoint cannot be RESOLVED without a model: `claude` is local or hosted depending
// on the arm's model (`src/lib/local/endpoint.ts`). So every probe the cockpit fired ran the binary
// check and the seat check and nothing else, and on a machine where the CLI is installed and the seat
// is logged in it returned a green light in a voice indistinguishable from a real pass — while the
// endpoint, model, context and server-version checks, the four the feature exists for, never ran.
//
// The arm is therefore what crosses the wire, validated by `normalizeArmSet` — the same validator the
// loop's start route and the cockpit's draft builder call, never a second parser — and the endpoint
// is resolved HERE, server-side, by the one function that owns that rule. The bare-transport form is
// gone rather than kept beside it: it had exactly one caller, and leaving the door that produced the
// false green light open beside its repair is how the repair gets routed around.
//
// Both halves of every arm are probed. A split arm ("Claude plans, a local model executes") points at
// two different things, and a green plan half says nothing whatever about the execute half.
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
import { normalizeArmPolicy, normalizeArmSet, planArmOf, type Arm, type TransportId } from "@/lib/local/arm";
import { resolveLocalEndpoint } from "@/lib/local/endpoint";
import { probeRefusal, probeTransport, type ProbeFinding, type ProbeResult } from "@/lib/local/transport/probe";
import type { LocalEndpoint } from "@/lib/local/transport/run";
import type {
  ArmHalfRole,
  ArmHalfVerdict,
  ArmProbeReply,
  ArmVerdict,
} from "@/features/inflight/live/cockpit/arms/armProbe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

interface Half {
  role: ArmHalfRole;
  transport: TransportId;
  model: string;
}

/** Both halves of an arm, in the order a failure should be read in. A non-split arm yields two halves
 *  that resolve to the same endpoint and therefore to the SAME probe — see `probeKey`. */
function halvesOf(arm: Arm): Half[] {
  const plan = planArmOf(arm);
  return [
    { role: "execute", transport: arm.transport, model: arm.model },
    { role: "plan", transport: plan.transport, model: plan.model },
  ];
}

/**
 * THE DE-DUPLICATION KEY: everything `probeTransport` actually reads.
 *
 * It is the transport plus the whole resolved endpoint, because those are the only two things the
 * probe's answer depends on — two arms naming the same model on the same server ask the server an
 * identical question, and a 27B's zero-token load takes tens of seconds, so asking it four times
 * would make the panel unusable. The REPORTING is not de-duplicated: every half keeps its own index
 * into the shared probe list, so the operator learns which arm is blocked rather than that something
 * is.
 */
function probeKey(transport: TransportId, endpoint: LocalEndpoint | null): string {
  return [
    transport,
    endpoint?.baseUrl ?? "",
    endpoint?.model ?? "",
    String(endpoint?.contextTokens ?? 0),
    endpoint?.token ?? "",
  ].join("\u0000");
}

/**
 * The finding a hosted half gets, so that "no endpoint was checked" is STATED rather than read off an
 * absence.
 *
 * An arm with no local half is a legitimate PASS — it is the subscription seat, which has no
 * inference server behind it — but a green light that is silent about the four checks it did not run
 * is the same shape of lie this whole route was rewritten to remove. So the pass says what it covers.
 */
const HOSTED_NOTE: ProbeFinding = {
  check: "endpoint",
  ok: true,
  observed:
    "no local endpoint — this half runs on the transport's own seat, so the binary and its authorization were checked " +
    "and the model, context and server-version checks do not apply",
  required: "a local endpoint, for the checks that read one",
};

/** The probe result with its hosted note spliced in where the endpoint findings would have been. */
function withHostedNote(r: ProbeResult): ProbeResult {
  const findings = [...r.findings];
  findings.splice(findings.findIndex((f) => f.check === "binary") + 1, 0, HOSTED_NOTE);
  return { ...r, findings };
}

/**
 * Probe every distinct (transport, endpoint) the set needs, then attribute the results to the arms.
 *
 * SERIAL on purpose. The slow step is the zero-token load that makes a model resident, and running
 * two of those at once against one inference server makes them evict each other — the probe would
 * then be measuring the contention it introduced.
 */
async function probeArms(arms: Arm[]): Promise<ArmProbeReply> {
  const index = new Map<string, number>();
  const jobs: { transport: TransportId; endpoint: LocalEndpoint | null }[] = [];
  const plan = arms.map((arm) => ({
    arm,
    halves: halvesOf(arm).map((h): ArmHalfVerdict => {
      const endpoint = resolveLocalEndpoint(h);
      const key = probeKey(h.transport, endpoint);
      let at = index.get(key);
      if (at === undefined) {
        at = jobs.length;
        index.set(key, at);
        jobs.push({ transport: h.transport, endpoint });
      }
      return { role: h.role, transport: h.transport, model: h.model, endpoint: endpoint?.baseUrl ?? null, probe: at };
    }),
  }));

  const probes: ProbeResult[] = [];
  for (const job of jobs) {
    const result = await probeTransport(job.transport, job.endpoint);
    probes.push(job.endpoint ? result : withHostedNote(result));
  }

  const verdicts: ArmVerdict[] = plan.map(({ arm, halves }) => {
    const failed = halves.find((h) => !probes[h.probe]?.ok) ?? null;
    const sentence = failed ? (probeRefusal(probes[failed.probe]!) ?? "the preflight probe failed.") : null;
    return {
      armId: arm.id,
      label: arm.label,
      ok: failed === null,
      refusal: failed ? `Arm “${arm.label}”, ${failed.role} half: ${sentence}` : null,
      halves,
    };
  });

  const refusal = verdicts
    .map((v) => v.refusal)
    .filter((s): s is string => s !== null)
    .join(" ");
  return { arms: verdicts, probes, refusal: refusal || null };
}

export async function POST(request: Request) {
  const guard = selfHostGuard();
  if (guard) return guard;

  const body = (await request.json().catch(() => ({}))) as {
    org?: unknown;
    arms?: unknown;
    armPolicy?: unknown;
  };
  const org = typeof body.org === "string" ? body.org.trim().toLowerCase() : "";
  if (!org) return bad("Missing 'org'.");
  if (org === PUBLIC_ORG) return NextResponse.json({ error: "The public funnel org has no transports." }, { status: 403 });
  if (!Array.isArray(body.arms)) return bad("Missing 'arms'.");
  // The policy decides the CARDINALITY rule only (one arm, or two to four). An absent one is read off
  // the set's own length rather than defaulted to `single`, so a caller that forgets the field still
  // gets its arms validated instead of a 400 that says nothing about them.
  const policy = normalizeArmPolicy(body.armPolicy) ?? (body.arms.length === 1 ? "single" : "compare");
  const arms = normalizeArmSet(body.arms, policy);
  if (!arms) return bad("'arms' is not an arm set this build accepts.");

  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;

  return NextResponse.json(await probeArms(arms));
}
