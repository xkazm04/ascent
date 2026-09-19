/**
 * The two org identifiers, told apart by the checker instead of by a comment.
 *
 * An org is addressed two ways and the tenant boundary depends on which one you are holding.
 * The **slug** is what a request carries (`?org=acme`) and what authorization is checked
 * against. The **id** is the tenant scope every store read is ANDed with. Both are `string`,
 * so nothing stopped a slug being passed where an id belongs — and `gateAthenaOrg` hands out
 * both at once, from one destructure, as `{ org, orgId }`.
 *
 * That confusion is silent in every instrument the repo has. A slug reaching a tenant-scoped
 * read matches no row, so the query returns empty rather than throwing: no error, no wrong
 * data on screen, just a feature that is quietly always blank for everyone. Typecheck cannot
 * see it because the two parameters have the same type, and a test only sees it if it happens
 * to assert on populated rows for a real org.
 *
 * ## Why a brand, and why it costs no migration
 *
 * A branded string is still assignable TO `string`, so giving the resolver's *output* a brand
 * breaks no existing caller — every consumer that takes a plain `string` keeps compiling. Only
 * the other direction is refused: a plain `string` (or an `OrgSlug`) can no longer be passed
 * where an `OrgId` is required. So the boundary can be raised one consumer at a time, and a
 * consumer that has not been migrated is exactly as safe as it was before, never less.
 *
 * ## What the brand does and does not prove
 *
 * It proves **provenance, not validity**: that the value came through `getOrgId`, which looked
 * the org up. It does not prove the org still exists, that the caller is authorized for it, or
 * that the string is non-empty. Freshness and authorization have clocks and stay where they
 * are — at the call site, in the gate. Read this as the door altitude only: the value's kind
 * says which lookup produced it.
 */

declare const orgIdBrand: unique symbol;
declare const orgSlugBrand: unique symbol;

/** A resolved org row id — the tenant scope. Minted only by `getOrgId`. */
export type OrgId = string & { readonly [orgIdBrand]: true };

/** A canonical (trimmed, lower-cased) org slug — what a request carries and authz checks. */
export type OrgSlug = string & { readonly [orgSlugBrand]: true };

/**
 * Mint an `OrgId`. The single legitimate call site is the resolver in `@/lib/db/org` that
 * actually performed the lookup; anywhere else this is an unchecked assertion and the reason
 * the brand proves provenance and not validity.
 */
export function asOrgId(value: string): OrgId {
  return value as OrgId;
}

/**
 * Canonicalize and brand an org slug. Org rows are PERSISTED lower-cased by the GitHub-App
 * install flow, so every lookup path canonicalizes the same way; doing it here means a caller
 * cannot mint a slug that skipped it.
 */
export function asOrgSlug(value: string): OrgSlug {
  return value.trim().toLowerCase() as OrgSlug;
}
