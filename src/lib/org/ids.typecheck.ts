/**
 * NEGATIVE ARTIFACT for the org tenant boundary. Its pass condition is a REFUSAL.
 *
 * This file is deliberately NOT named as a test. `tsconfig.json` excludes every `*.test.ts`
 * from the typecheck, so a type-level artifact in a test file is read by no rung at all and
 * cannot fail. It was written that way first, and removing the brands left the typecheck
 * green, which is how that hole was found. Here the file sits inside `include`, so
 * `npm run typecheck` reads it, and therefore so does `npm run verify`.
 *
 * The invariant: a tenant-scoped store read is ANDed with the org *id*, never the *slug*.
 * Both are strings. Measured on 2026-09-16 before the brands existed, injecting
 * `listAthenaThreads(ctx.org)` into the threads route produced 0 typecheck errors and 70 of
 * 70 green tests. Nothing in the repo could see it.
 *
 * Seen red at birth: with either brand in `./ids.ts` widened back to a plain string, the
 * `@ts-expect-error` below becomes an unused directive (TS2578) and the typecheck fails.
 */
import { asOrgId, asOrgSlug } from "@/lib/org/ids";
import type * as AthenaThreads from "@/lib/db/athena-threads";

type TenantScopedParam = Parameters<typeof AthenaThreads.listAthenaThreads>[0];

const slug = asOrgSlug("acme");
const id = asOrgId("org_123");

// @ts-expect-error - an OrgSlug may not stand in for the tenant id a store read is ANDed with
const confused: TenantScopedParam = slug;

// The resolved id is accepted, and stays assignable to `string`, so a consumer that still takes
// a plain string keeps compiling: the altitude rises one consumer at a time, never all at once.
const scoped: TenantScopedParam = id;
const asPlainString: string = id;

void confused;
void scoped;
void asPlainString;
