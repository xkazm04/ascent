// WHICH registry actions may be rendered, as a pure function of `view.capabilities`.
//
// A dead "Create repository" button that 403s on click is worse than no button: it teaches the user
// the product is broken (src/lib/registry/capabilities.ts states the same rule from the other side).
// So the rule lives here, in one testable place, rather than as scattered `&&` in JSX — the rendering
// components ask this what to draw and draw exactly that.
//
// The floor is deliberately conservative: when the App is not configured or not installed, NO GitHub
// affordance renders at all — not even a link to `github.com/<org>/ai-registry`, because that repo
// very probably does not exist and a 404 is a worse answer than a sentence.

import type { RegistryCapabilities, RegistryCapabilityReason } from "@/lib/registry/capabilities";

export type RegistryActionId =
  /** Create `<org>/<name>` and open the scaffold PR. Needs `canCreateRepo` (org account + admin:write). */
  | "create-registry"
  /** Map a repo that already exists, by `owner/repo`. */
  | "map-existing"
  /** Re-read the mapped registry at HEAD and rebuild the mirror rows. */
  | "reindex"
  /** Open one migration PR per artifact type. */
  | "migrate"
  /** Plain link to the mapped repo on GitHub. */
  | "open-repo"
  /** The one link offered when the App is missing — install/configure it. */
  | "install-app";

/**
 * The actions the panel may render for this viewer.
 *
 * @param caps  `view.capabilities` — every flag resolved from a real precondition, failing closed.
 * @param opts.mapped  whether an `OrgRegistry` row exists (`view.status !== "unmapped"`).
 */
export function visibleActions(caps: RegistryCapabilities, opts: { mapped: boolean }): RegistryActionId[] {
  // Nothing to act THROUGH: no App on this deployment, or none installed on this org. The only
  // honest affordance is the install link, and only when there is one to give.
  if (!caps.appConfigured || !caps.installed) return caps.installUrl ? ["install-app"] : [];
  // Installed, but this viewer may not write (role floor, or no mintable token). Read-only.
  if (!caps.canWrite) return [];
  if (!opts.mapped) return caps.canCreateRepo ? ["create-registry", "map-existing"] : ["map-existing"];
  return ["reindex", "migrate", "open-repo"];
}

/** Convenience predicate so JSX reads as a question rather than an `includes` chain. */
export function canRender(actions: readonly RegistryActionId[], id: RegistryActionId): boolean {
  return actions.includes(id);
}

/**
 * The one honest line explaining why no action is offered — `null` when everything is present.
 * Rendered INSTEAD of buttons, never beside them.
 */
export function capabilityNotice(caps: RegistryCapabilities, slug: string): string | null {
  const reason: RegistryCapabilityReason | null = caps.reason;
  if (!reason) return null;
  switch (reason) {
    case "persistence-off":
      return "This workspace is running without a database, so a registry cannot be mapped or read here.";
    case "app-not-configured":
      return "Ascent's GitHub App is not configured on this deployment, so there is nothing to connect a registry through.";
    case "not-installed":
      return `Ascent's GitHub App is not installed on ${slug}. Install it and the registry actions appear here.`;
    case "insufficient-role":
      return "You are reading this registry, not wiring it — an org admin can map the repo, re-index it and open the migration PRs.";
    case "token-not-mintable":
      return "Ascent cannot currently act on this organization's behalf, so the registry actions are withheld rather than shown and failed.";
  }
}

/** `{ error, code }` bodies, as sentences. The server's `error` is preferred; this is the fallback. */
export const ERROR_SENTENCE: Record<string, string> = {
  "persistence-off": "This workspace has no database, so nothing could be saved.",
  "invalid-input": "That input was rejected — check the repository name.",
  "not-permitted": "Ascent is not allowed to do that on this organization.",
  "not-mapped": "No registry is mapped yet — map one first.",
  "already-installed": "That repository is already a registry.",
  "github-error": "GitHub rejected the request. Try again in a moment.",
  "no-op": "There was nothing to do.",
};

/** Human sentence for a failed call: the route's own message when it sent one, else the code's. */
export function errorSentence(body: { error?: unknown; code?: unknown } | null, status?: number): string {
  const error = typeof body?.error === "string" && body.error.trim() ? body.error.trim() : null;
  const code = typeof body?.code === "string" ? body.code : null;
  if (error) return code ? `${error} (${code})` : error;
  if (code && ERROR_SENTENCE[code]) return `${ERROR_SENTENCE[code]} (${code})`;
  return `The request failed${status ? ` (HTTP ${status})` : ""}.`;
}

/** Client-side `owner/repo` validation — the same shape `parseFullName` accepts on the server. */
const FULL_NAME_RE = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;

export function isFullName(value: string): boolean {
  const v = value.trim();
  return FULL_NAME_RE.test(v) && !v.split("/").some((p) => p === "." || p === "..");
}

/** The reference registry — the example the "map an existing repo" field is seeded with. */
export const EXAMPLE_REGISTRY = "xkazm04/ai-registry";
