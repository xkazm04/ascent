// Shared request plumbing for `/api/org/[slug]/registry/**`.
//
// The three routes all need the same four things in the same order — persistence, the role gate, the
// capability gate, an installation token — and all must FAIL CLOSED with a typed body the tab can
// render. Centralized here so a new registry route cannot accidentally skip a step, and so the error
// shape stays one shape: `{ error: string, code: RegistryErrorCode }`.

import { NextResponse } from "next/server";
import { AppApiError } from "@/lib/github/app";
import { getInstallationToken } from "@/lib/github/app";
import { getInstallationIdForOwner } from "@/lib/db/installations";
import { isDbConfigured } from "@/lib/db/client";
import { requireOrgRead, requireOrgRole } from "@/lib/authz";
import { getRegistryCapabilities, type RegistryCapabilities } from "./capabilities";

export type RegistryErrorCode =
  | "persistence-off"
  | "invalid-input"
  | "not-permitted"
  | "not-mapped"
  | "already-installed"
  | "github-error"
  | "no-op";

export function registryError(code: RegistryErrorCode, error: string, status: number): NextResponse {
  return NextResponse.json({ error, code }, { status });
}

/** Map a thrown GitHub failure to a typed body. NEVER a 500: the UI must be able to say what broke. */
export function githubErrorResponse(err: unknown): NextResponse {
  if (err instanceof AppApiError) {
    const status = err.status === 401 || err.status === 403 ? 403 : err.status === 404 ? 404 : 502;
    const message =
      status === 403
        ? "Ascent's GitHub App is not authorized for that repository. Check its installation and permissions."
        : status === 404
          ? "That repository is not visible to Ascent's GitHub App."
          : `GitHub rejected the request (${err.status}).`;
    return registryError("github-error", message, status);
  }
  return registryError("github-error", "GitHub could not be reached. Try again in a moment.", 502);
}

/** READ gate: a 401/403 response to send back, or null when the viewer may read `slug`. */
export async function guardRegistryRead(slug: string): Promise<NextResponse | null> {
  if (!isDbConfigured()) return registryError("persistence-off", "The registry requires a database.", 503);
  return requireOrgRead(slug);
}

export interface RegistryWriteContext {
  token: string;
  capabilities: RegistryCapabilities;
}

const REASON_TEXT: Record<string, string> = {
  "persistence-off": "The registry requires a database.",
  "app-not-configured": "Ascent's GitHub App is not configured on this deployment.",
  "not-installed": "Install Ascent's GitHub App on this organization first.",
  "insufficient-role": "You need an admin role in this organization to change its registry.",
  "token-not-mintable": "Ascent cannot act on this organization's behalf.",
};

/**
 * WRITE gate: role check, capability check, then mint the installation token. Returns the context on
 * success or the response to send back. `minRole` defaults to `admin`, matching the floor the tab's
 * `capabilities` block is resolved at, so a rendered button and its route agree by construction.
 */
export async function guardRegistryWrite(
  slug: string,
  opts: { minRole?: "owner" | "admin" | "member" } = {},
): Promise<RegistryWriteContext | NextResponse> {
  if (!isDbConfigured()) return registryError("persistence-off", "The registry requires a database.", 503);
  const minRole = opts.minRole ?? "admin";

  const denied = await requireOrgRole(slug, minRole);
  if (denied) return denied;

  const capabilities = await getRegistryCapabilities(slug, { minRole, probeCreate: false });
  if (!capabilities.canWrite) {
    const reason = capabilities.reason ?? "token-not-mintable";
    return registryError("not-permitted", REASON_TEXT[reason] ?? "Ascent cannot act on this organization.", 403);
  }

  const installationId = await getInstallationIdForOwner(slug).catch(() => null);
  if (!installationId) return registryError("not-permitted", REASON_TEXT["not-installed"]!, 403);
  try {
    return { token: await getInstallationToken(installationId), capabilities };
  } catch (err) {
    return githubErrorResponse(err);
  }
}
