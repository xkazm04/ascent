// Route guard for LOCAL MODE surfaces (pairing, local rescan, autopilot): these read and write the
// SERVER's filesystem and spawn local processes, which only makes sense — and is only safe to
// expose — on a self-hosted deployment where the operator owns the box. On managed cloud the routes
// answer 404, not 403: the surface doesn't exist there, and a 403 would advertise that it could.

import { NextResponse } from "next/server";
import { selfHosted } from "@/lib/env";

/** 404 on a managed-cloud deployment, null when the local-mode surface may proceed. */
export function selfHostGuard(): NextResponse | null {
  if (selfHosted()) return null;
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}
