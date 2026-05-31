// POST /api/app/webhook — GitHub App events. Verifies the HMAC signature, then keeps
// stored installations in sync. (Push-triggered auto-rescan is a later enhancement;
// for now we acknowledge those events.)

import { NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/github/app";
import { removeInstallation, upsertInstallation } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InstallationPayload {
  action?: string;
  installation?: { id: number; account?: { login?: string } };
}

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyWebhook(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const event = request.headers.get("x-github-event") ?? "";
  let payload: InstallationPayload = {};
  try {
    payload = JSON.parse(raw) as InstallationPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    if (event === "installation") {
      const login = payload.installation?.account?.login;
      const id = payload.installation?.id;
      if (id != null) {
        if ((payload.action === "created" || payload.action === "unsuspend") && login) {
          await upsertInstallation({ login, installationId: id });
        } else if (payload.action === "deleted" || payload.action === "suspend") {
          await removeInstallation(id);
        }
      }
    }
    // installation_repositories / push: repos are listed on demand, so no-op for now.
  } catch (err) {
    console.error("[app/webhook] handler error", err);
    // Still 200 so GitHub doesn't endlessly retry on our transient DB issues.
  }

  return NextResponse.json({ ok: true, event });
}
