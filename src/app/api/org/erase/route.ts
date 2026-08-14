// POST /api/org/erase { org, confirm, repo?, includeAudit? } -> EraseResult
//
// On-demand, owner-gated data erasure (DSR / GDPR Art.17 "right to erasure", the control an
// enterprise vendor-review checklist asks for). Until this route existed, deletion was SCHEDULE-only:
// data left on the nightly /api/cron/purge timetable and there was no way for a customer to say
// "erase my data now". This is that button. See docs/features/data/retention.md.
//
// Two scopes, one handler (the repo variant is the same operation with a narrower target):
//   • org-wide  — { org, confirm: org }                  → every repo's scan graph in the org
//   • per-repo  — { org, confirm: "owner/name", repo }   → that one repo's scan graph
// `includeAudit: true` (org scope only) additionally erases the org's ENTIRE audit trail.
//
// Route shape follows this repo's org-API convention — a flat `/api/org/<verb>` with the tenant in the
// body — NOT a `/api/org/[slug]/…` path segment: there is no `[slug]` directory anywhere under
// src/app/api/org, every sibling (segments, credits/grant, members, watch) takes `{ org }` in the body
// or `?org=`, and the authz helpers are written against that shape.
//
// GUARDS, in order (each is proven by a test in route.test.ts):
//   1. same-origin  — CSRF. A bare cross-site POST must never be able to nuke a tenant, and the
//                     session cookie is only SameSite=Lax, which does not stop a cross-site form POST
//                     from carrying it. Mirrors the destructive/money-adjacent siblings
//                     (credits/grant, auth/revoke-sessions) which use the same shared helper.
//   2. confirm      — the caller must ECHO the exact thing being erased (the org slug, or the repo's
//                     full name for the repo variant). A payload that doesn't type the name back is a
//                     400 before any authz work, so an accidental/replayed `{org}`-only POST from a
//                     script cannot delete anything.
//   3. owner role   — requireOrgRole(org, "owner"). Irreversible, so it is not a member action.

import { NextResponse } from "next/server";
import { requireOrgRole } from "@/lib/authz";
import { requireSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { eraseOrgData } from "@/lib/db/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// COUPLED CONSTANT: this literal MUST equal ERASE_MAX_DURATION_S in src/lib/db/retention.ts — the
// erase's soft time budget is derived from it (cap − headroom) so a large tenant stops at a batch
// boundary and returns a resumable partial result instead of being hard-killed mid-delete. Next.js
// requires this segment config to be a statically-analyzable literal, so it cannot import the
// constant; route.test.ts pins the equality instead (same contract as /api/cron/purge).
export const maxDuration = 60;

interface EraseBody {
  org?: string;
  confirm?: string;
  repo?: string;
  includeAudit?: boolean;
}

export async function POST(request: Request) {
  // (1) CSRF first, before the body is even read — a cross-origin caller learns nothing.
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const body = (await request.json().catch(() => ({}))) as EraseBody;
  const org = body.org?.trim();
  const repo = body.repo?.trim();
  const confirm = body.confirm?.trim();
  if (!org) return NextResponse.json({ error: "Provide { org, confirm }." }, { status: 400 });

  // (2) Typed confirmation. The expected phrase is the TARGET's own name: the repo's full name for
  // the repo variant, the org slug otherwise — so confirming an org-wide erase can never be satisfied
  // by a payload that meant to scope to one repo. Org slugs are case-insensitive everywhere in this
  // app (authz lowercases them); a repo full name is matched exactly, like its DB lookup.
  const target = repo || org;
  const matches = repo ? confirm === repo : (confirm ?? "").toLowerCase() === org.toLowerCase();
  if (!matches) {
    return NextResponse.json(
      { error: `Confirmation required: set "confirm" to "${target}" to erase it. This cannot be undone.` },
      { status: 400 },
    );
  }

  // (3) Owner-only. requireOrgRole returns the ready-to-send 401/403; propagate it verbatim.
  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;

  const actorId = (await resolveViewerLogin()) ?? undefined;
  const outcome = await eraseOrgData({
    orgSlug: org,
    repoFullName: repo || undefined,
    includeAudit: body.includeAudit === true,
    actorId,
  });

  if (!outcome.ok) {
    if (outcome.reason === "no-db") {
      return NextResponse.json({ error: "Erasure requires a database." }, { status: 503 });
    }
    if (outcome.reason === "unknown-repo") {
      return NextResponse.json({ error: "Unknown repository in this organization." }, { status: 404 });
    }
    return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  }

  const { ok: _ok, ...result } = outcome;
  // A PARTIAL erase (the wall-clock budget stopped it at a batch boundary) or a lost `data.erased`
  // trace must not report a green 200 — for a compliance control, "mostly erased" and "erased with no
  // record" are both degraded outcomes the caller has to act on. Every committed batch is durable, so
  // resuming is simply the same request again (idempotent).
  if (!result.complete || !result.audited) {
    console.warn("[org/erase] completed degraded", {
      org: result.orgSlug,
      complete: result.complete,
      audited: result.audited,
    });
    return NextResponse.json(
      {
        ...result,
        resumable: !result.complete,
        error: result.complete
          ? "Data erased, but the data.erased audit entry could not be written."
          : "Erasure stopped at a safe boundary before finishing. Repeat this request to resume.",
      },
      { status: 207 },
    );
  }
  return NextResponse.json(result);
}
