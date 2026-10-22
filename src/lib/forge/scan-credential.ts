// The scan credential's DESTINATION BINDING (credential-vault: a credential is bound at admission to
// the service that issued it, and the door refuses to apply it anywhere else).
//
// Every token a scan can carry today is a GitHub one: the org's App installation mint, the operator's
// ambient `GITHUB_TOKEN`, a PR gate's installation token. Handing any of them to another forge's
// source sends a credential that can read the org's private GitHub repos to a third-party host as a
// `Bearer` header (forge/gitlab/http.ts). The rule used to live inline in the two scan routes only, so
// the queue worker and the org import each forgot it. It lives here now, and `scanRepository` calls it
// itself, so no caller (present or future) can route a GitHub credential to a non-GitHub forge.
//
// Fail closed: an UNLABELLED token is a GitHub token, because that is what every token in the codebase
// is. A caller holding a credential for another forge must say so with `tokenForge`.
//
// Pure (no env read, no I/O) so it is testable without a scan; `scanRepository` passes the ambient value.

import type { ForgeId } from "@/lib/forge/types";

/** The ambient `GITHUB_TOKEN` is a GitHub credential: it may ride a GitHub scan and nothing else. */
export function ambientAllowedFor(forge: ForgeId): boolean {
  return forge === "github";
}

export interface BindScanTokenInput {
  /** The forge the scan is routed to (where the token would be sent). */
  forge: ForgeId;
  /** An explicit credential from the caller. */
  token?: string;
  /** The forge that issued `token`. Absent means GitHub (fail closed: every token today is one). */
  tokenForge?: ForgeId;
  /** The caller refused the ambient fallback (public surfaces, an installed org it cannot mint for). */
  noAmbientToken?: boolean;
  /** The ambient operator token (`process.env.GITHUB_TOKEN`), offered only to a GitHub scan. */
  ambient?: string;
}

export interface BoundScanToken {
  token: string | undefined;
  /** Set when an explicit token was refused because it was issued for a different forge. */
  dropped?: "forge-mismatch";
}

/** The credential a scan of `forge` may use. An explicit token flows only to the forge that issued
 *  it; the ambient token only to GitHub, and only when the caller did not refuse it. */
export function bindScanToken(input: BindScanTokenInput): BoundScanToken {
  if (input.token !== undefined) {
    if ((input.tokenForge ?? "github") === input.forge) return { token: input.token };
    return { token: undefined, dropped: "forge-mismatch" };
  }
  if (input.noAmbientToken || !ambientAllowedFor(input.forge)) return { token: undefined };
  return { token: input.ambient };
}

/** The operator-visible trace of a refused bind. Names the two forges, NEVER the token value. */
export function warnDroppedScanToken(forge: ForgeId, tokenForge: ForgeId | undefined): void {
  console.warn(
    `[scan] a ${tokenForge ?? "github"} credential was not sent to a ${forge} scan (forge-bound token); scanning token-less.`,
  );
}
