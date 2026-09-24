// /api/me/mentor/share: the signed-in developer's own care share (C3, backlog develop-2026-09-17 row 46,
// docs/features/org-dashboard/developer.md).
//
//   GET     the viewer's stored share, or 404 when they have none
//   POST    replace it with a validated snapshot { contract: 1, profile?, moves?, journal?, shape?, setup? }
//   DELETE  remove it; 404 when there was nothing to remove
//
// OWNER-SELF, and only that. Identity is `resolveViewerLogin()` (the same resolution the Developer page
// reads under), never a query, a body or a header, and the body is refused if it names anyone at all
// (`validateCareShare`). There is no id in the path, so no request can address another person's row:
// another login reading or deleting gets the same 404 as someone who never shared, and nothing tells
// them whether a share exists for anyone else.
//
// A body carrying a transcript, prompt, diff or file-contents key is refused with 400, at any depth.
// The raw body is capped (`CARE_SHARE_MAX_BYTES`) before it is parsed.
//
// AUTH is the browser session. The documented `npx ascent mentor share` has no per-user credential to
// send: the only bearer tokens in the product (`org-api-tokens.ts`, the MCP door) are ORG-scoped and
// carry no person, so accepting one here would let any holder write as anyone. That half is a Known gap.

import { NextResponse } from "next/server";
import { resolveViewerLogin } from "@/lib/access";
import { isDbConfigured } from "@/lib/db";
import { deleteMentorShare, getMentorShare, saveMentorShare } from "@/lib/db/mentor-share";
import { CARE_SHARE_MAX_BYTES, validateCareShare } from "@/lib/org/care-share-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = { error: "No share is stored for you." };

/** The gate every verb shares: a database, then a signed-in viewer. Returns the login or a response. */
async function viewerOrRefusal(): Promise<string | NextResponse> {
  if (!isDbConfigured()) return NextResponse.json({ error: "Sharing requires a database." }, { status: 503 });
  const login = await resolveViewerLogin();
  if (!login?.trim()) return NextResponse.json({ error: "Sign in to share your care loop." }, { status: 401 });
  return login;
}

export async function GET() {
  const login = await viewerOrRefusal();
  if (typeof login !== "string") return login;
  const row = await getMentorShare(login);
  return row ? NextResponse.json(row) : NextResponse.json(NOT_FOUND, { status: 404 });
}

export async function POST(request: Request) {
  const login = await viewerOrRefusal();
  if (typeof login !== "string") return login;

  const tooLarge = NextResponse.json({ error: `A share is at most ${CARE_SHARE_MAX_BYTES / 1024} KB.` }, { status: 413 });
  if (Number(request.headers.get("content-length") ?? 0) > CARE_SHARE_MAX_BYTES) return tooLarge;
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > CARE_SHARE_MAX_BYTES) return tooLarge;

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "The share is not valid JSON." }, { status: 400 });
  }
  const valid = validateCareShare(body);
  if (!valid.ok) return NextResponse.json({ error: "The share was refused.", errors: valid.errors }, { status: 400 });

  try {
    const saved = await saveMentorShare(login, valid.share);
    if (!saved) return NextResponse.json({ error: "Sharing requires a database." }, { status: 503 });
    return NextResponse.json({ ok: true, sharedAt: saved.sharedAt });
  } catch (err) {
    console.error("[me/mentor/share] save failed", err);
    return NextResponse.json({ error: "Failed to store your share." }, { status: 500 });
  }
}

export async function DELETE() {
  const login = await viewerOrRefusal();
  if (typeof login !== "string") return login;
  const deleted = await deleteMentorShare(login);
  return deleted ? NextResponse.json({ ok: true }) : NextResponse.json(NOT_FOUND, { status: 404 });
}
