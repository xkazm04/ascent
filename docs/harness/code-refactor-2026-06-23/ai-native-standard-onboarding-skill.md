# Code Refactor — AI-Native Standard & Onboarding Skill
> Context group: Onboarding, Shell & AI Standard
> Total: 3 findings (Critical: 0, High: 1, Medium: 0, Low: 2)

This context is, on the whole, unusually clean: the modules are small, single-purpose, well-commented, and free of dead code, stray `console.log`/debug, commented-out blocks, or stale TODOs in the TypeScript source. (The `TODO:` strings in `manifest.ts` / `context.ts` are intentional *product content* — placeholders baked into the generated `.ai/` files for the adopting repo to fill in — not cruft.) The test files are thorough and deliberately mirror shipped logic (the doctor-parser and maintain-note extractions), which is by-design, not duplication to consolidate. The findings below are the few genuine, behavior-preserving cleanups worth making.

## 1. `parseRepo(q)` route helper is duplicated verbatim across the report routes
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/report/skill/route.ts:17-24
- **Scenario**: The exact `parseRepo(q): { owner; name; sha? }` function — including the `owner/name@sha` query-string convention, the `slash <= 0 || slash === base.length - 1` guard, and the empty-sha-after-`@` handling — appears byte-for-byte in `skill/route.ts`, `pdf/route.ts:18-25`, and `passport/route.ts:18-25`. (The `passport/overrides` and `passport/pr` routes carry a near-identical two-field variant without the `sha`.) All parse the same `?repo=` shorthand the same way.
- **Root cause**: Each report-export route was written by copy-pasting the previous one's request-parsing boilerplate rather than importing a shared parser. There is already a canonical `parseRepoUrl` in `src/lib/github/source.ts`, but it parses full GitHub URLs and does not handle the `@sha` query suffix these routes use, so each route rolled its own instead of extending the canonical one.
- **Impact**: Three+ identical copies of security-relevant input parsing. A fix or hardening to one copy (e.g. tightening the owner/name validation, or a new `@`-handling rule) silently misses the others — this is exactly the "two copies already in the wild, primed to drift" hazard. It also inflates each route file and obscures that the routes share one contract.
- **Fix sketch**: Extract the shared parser into a small helper colocated with the report routes, e.g. `src/app/api/report/_shared.ts` (or a function in `@/lib/github/source.ts` alongside `parseRepoUrl`, named e.g. `parseRepoRef` to signal the `@sha` query form). Have `skill/route.ts`, `pdf/route.ts`, and `passport/route.ts` import it and delete their local copies; fold the two-field `passport/overrides`/`pr` variant in by treating `sha` as optional. Behavior-preserving: the body is identical, so each call site keeps the same return shape.

## 2. `safe()` Content-Disposition filename sanitizer is duplicated across export routes
- **Severity**: Low
- **Category**: duplication
- **File**: src/app/api/report/skill/route.ts:56
- **Scenario**: `const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "-")` — the per-segment filename sanitizer used to build the `content-disposition` header — is repeated identically in `passport/route.ts:27` and `pdf/route.ts` (the same export-route family that also duplicates `parseRepo`, finding #1).
- **Root cause**: Same copy-paste lineage as the route handlers; the header-safety one-liner travelled along with the boilerplate.
- **Impact**: Small, but it is a *security-shaped* sanitizer (it prevents header/path injection via a caller-supplied `sha`/`owner`/`name`). Divergence between copies means one route could be hardened or loosened without the others. Low blast radius because the regex is trivial and well-commented at each site.
- **Fix sketch**: Move `safe` next to the shared `parseRepo` helper from finding #1 (same module) and import it in all three routes. One line per route deleted; identical output, so fully behavior-preserving.

## 3. Speculative barrel re-exports with no consumers (`ControlLayer`, and `Capability`/`ManifestData`/`MANIFEST_SCHEMA_VERSION`)
- **Severity**: Low
- **Category**: dead-code
- **File**: src/lib/onboarding/index.ts:9 (and src/lib/standard/index.ts:20-21)
- **Scenario**: `onboarding/index.ts` re-exports `type ControlLayer`, but `ControlLayer` is referenced only inside `tracks.ts` itself — no module imports it from the `@/lib/onboarding` barrel. Similarly, `standard/index.ts` re-exports `MANIFEST_SCHEMA_VERSION`, `ManifestData`, and `Capability`, none of which has a consumer outside `src/lib/standard/**` (they are imported directly from `./types` internally; `Capability` is used only within `types.ts`). The barrels themselves are *not* dead — `buildOnboardingSkill`, `selectTracks`, `WEAK_THRESHOLD`, `OnboardingTrack`, `SelectOpts`, `buildFoundation`, and `GeneratedFile` are all consumed externally.
- **Root cause**: The barrels were authored to expose the "full" public surface of each module proactively ("thin barrel so callers import from `@/lib/...` regardless of layout"), including types that no external caller has needed yet.
- **Impact**: Minor. It overstates the public API (a maintainer reading the barrel assumes these are load-bearing exports and hesitates to change them), and a linter configured for unused exports would flag them. No bundle/behavior cost. NOTE: keep this Low and optional — re-exporting a module's own types from its barrel is a common, defensible convention, so this is a judgment-call cleanup, not a must-fix; the named-symbol re-exports below it are genuinely used.
- **Fix sketch**: If the codebase's convention is "barrel exposes only what's actually imported elsewhere," drop the `type ControlLayer` line from `onboarding/index.ts:9` and the `MANIFEST_SCHEMA_VERSION` / `ManifestData` / `Capability` entries from `standard/index.ts:20-21` (keeping `GeneratedFile`, which `skill.ts` imports). Purely removing unused re-exports — no runtime effect. If the team prefers barrels to mirror the full type surface, leave as-is; this finding can be declined.
