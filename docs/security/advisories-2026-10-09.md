# npm advisories after next 16.3.8 — triage, 2026-10-09

**Scope:** report-only triage of what `npm audit` still flags after the next 16.3.8 upgrade
(`84c2f07b`, `b1bf23e6`). Question: which advisories can reach production at runtime, and which are
dev-only or build-time. Nothing was installed, updated or edited; paths and `dev` flags are read from
the `packages` entries of `package-lock.json`, patched versions from `npm view`.

## Totals (measured at `97af0066`)

`npm audit --json`: critical 0, **high 14, moderate 3, total 17** — the same as run 419b78ba.
17 audit entries = 17 packages; `brace-expansion` is one entry with three installed copies.

| Class | Packages | Count |
| --- | --- | --- |
| runtime | none | **0** |
| build-time | nanoid, source-map-js, browserslist, baseline-browser-mapping, brace-expansion (the glob copy; its other two copies are dev-only) | **5** |
| dev-only | @next/eslint-plugin-next, eslint-config-next, fast-glob, micromatch, braces, @prisma/config, prisma, deepmerge-ts, js-yaml, undici, vitest, @vitest/mocker | **12** |

## Why nothing is runtime

- **Self-hosted image** (`Dockerfile`): `npm ci` (all deps) runs in the `deps`/`build` stages;
  the `runtime` stage copies only `.next/standalone` (Next's traced, minimal `node_modules`), `.next/static`,
  `public` and `prisma/`. A package that no server code `require`s is not traced into it.
- **Next's server code does not load the build-time packages.** In `node_modules/next/dist` the only
  non-compiled `require("postcss")` sites are `build/webpack/**` (css config, next-font loader,
  resolve-url-loader, css-minimizer). `dist/server`, `dist/shared`, `dist/client` have no requires of
  postcss, nanoid, source-map-js or baseline-browser-mapping (only `.js.map` text matches).
  `baseline-browser-mapping` is referenced only from `dist/compiled/browserslist`, i.e. the build's
  target resolution.
- **App code** (`src`, `scripts`, `next.config.*`) imports none of the 11 flagged non-eslint packages.
  Nothing is shipped to the browser: none is in a client bundle path.
- Hosted (Vercel) deploys run `next build` and serve its output; same reasoning.

## Advisories

Fix route: **direct** = bump a root dependency; **override** = `overrides` entry (a patched version exists
and satisfies the parent's range); **upstream** = needs a release of the named package.
Every advisory below is a denial-of-service or local-file class except where noted.

| Package | GHSA | Sev | Installed | Path | Class | Evidence | Patched / fix route |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nanoid | GHSA-2v37-7h3g-55p8 (custom generator loops on size 0) | high | 3.3.17 (no dev flag) | next > postcss > nanoid | build-time | Only postcss requires it; postcss is required by next's `build/webpack` only. Next's `nanoid` runtime use is its own `compiled/nanoid`. The bug needs a caller passing size 0 to a custom generator; postcss does not. | 3.3.18 (<3.3.18). **override**, or wait for next to bump postcss's range. |
| source-map-js | GHSA-68fv-2mgg-jv7q (event-loop DoS via indexed source-map section offsets) | high | 1.2.1 (no dev flag) | next > postcss > source-map-js | build-time | Same postcss path; also pulled by dev-only tailwind/magicast/css-tree. Needs a hostile source map fed to the build. | 1.2.2. **override** (postcss range `^1.2.1` admits it). |
| browserslist | GHSA-c83g-rgw3-j3cx (unbounded cache growth), GHSA-73wf-gq98-2v4g (crash via untrusted `browserslist-stats.json`) | high | 4.28.2 (no dev flag) | @sentry/nextjs > @sentry/bundler-plugin-core > @babel/core > @babel/helper-compilation-targets > browserslist | build-time | Lock marks it non-dev only through the Sentry build plugin (a production dependency of `@sentry/nextjs`, run in `next build`). Next uses its own `compiled/browserslist`. Both advisories need attacker-controlled queries/stats files, which the repo does not accept. | 4.28.7 (<=4.28.6). `npm update browserslist` (parents ask `^4`); the operator re-locks. |
| baseline-browser-mapping | GHSA-w5vr-8v7q-w6rv (process termination on invalid input) | moderate | 2.10.32 (no dev flag) | next > baseline-browser-mapping (also via browserslist) | build-time | A `dependency` of next, referenced only by next's `compiled/browserslist` (build target resolution); absent from `dist/server`. | 2.11.0. Within `next`'s `^2.9.19` and browserslist's `^2.10.12`: `npm update baseline-browser-mapping`. |
| brace-expansion | GHSA-q2hr-2g5m-vwhr (quadratic CPU), GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p (stack exhaustion on nested braces) | high | 5.0.9 under glob (no dev flag); 5.0.9 under typescript-estree (dev); 1.1.18 (dev) | glob copy: @sentry/nextjs > @sentry/bundler-plugin-core > glob > minimatch > brace-expansion. dev copies: eslint-config-next > typescript-eslint > @typescript-eslint/typescript-estree > minimatch; eslint > minimatch | build-time (glob copy), dev-only (two others) | The only non-dev copy is the Sentry bundler plugin's file globbing at build, with patterns from the Sentry config, not from users. | 5.0.12 and 1.1.21. **override** `brace-expansion` per major, or a minimatch/glob bump upstream. |
| @next/eslint-plugin-next | (via fast-glob) | high | 16.3.8 | eslint-config-next > @next/eslint-plugin-next | dev-only | `dev: true` on every entry. | Resolves when braces does; **upstream** (next / eslint-config-next). npm's suggested fix (eslint-config-next 14.2.35) is a *downgrade* — do not take it. |
| eslint-config-next | (via @next/eslint-plugin-next) | high | 16.3.8 | direct devDependency | dev-only | `dev: true`. | As above. |
| fast-glob | (via micromatch) | high | 3.3.1 | ... > @next/eslint-plugin-next > fast-glob | dev-only | `dev: true`. | Latest 3.3.3 still pulls micromatch; clears when braces does. |
| micromatch | (via braces) | high | 4.0.8 | ... > fast-glob > micromatch | dev-only | `dev: true`. | Latest is 4.0.8; clears when braces does. |
| braces | GHSA-vfj7-8cjw-p6xm (stack exhaustion on deeply nested patterns) | high | 3.0.3 | ... > micromatch > braces | dev-only | `dev: true`; lints the repo's own source globs. | **No patched version published** (3.0.3 is latest; range is `<=3.0.3`). Wait for upstream; no override possible. |
| @prisma/config | (via deepmerge-ts) | high | 6.19.3 | prisma > @prisma/config | dev-only | `dev: true`. The runtime client (`@prisma/client`, `@prisma/adapter-pg`) does not load it; `prisma` is a devDependency used by `prisma generate` (postinstall) and `migrate`. | **upstream** (prisma). |
| prisma | (via @prisma/config) | high | 6.19.3 | direct devDependency | dev-only | `dev: true`. | Latest stable 7.10.0 still depends on deepmerge-ts 7.1.5; npm's "fix" (prisma 6.12.0) is a downgrade — do not take it. |
| deepmerge-ts | GHSA-ggr8-5vv4-36mx (stack exhaustion on recursive graphs) | high | 7.1.5 | prisma > @prisma/config > deepmerge-ts | dev-only | `dev: true`. Merges the prisma config file, which is repo-owned. | 8.0.0+ exists, but it is a major bump of a pinned dependency: **override** is possible, **upstream** is safer. |
| js-yaml | GHSA-2883-xcg3-v3hh (merge-key CPU) | high | 4.3.1 | eslint > @eslint/eslintrc > js-yaml | dev-only | `dev: true`. | 4.3.2. **override**, or `npm update js-yaml`. |
| undici | ten advisories (WebSocket, retry, decompression, cookies, TLS in BalancedPool), highest high; fixed in one release | high | 7.29.0 | jsdom > undici | dev-only | `dev: true`; test environment only. The app uses Node's built-in `fetch`, not this copy. | 7.29.1. `npm update undici` (inside jsdom's range) or a jsdom bump. |
| vitest | GHSA-82fw-gwwq-j7x9 (path traversal / arbitrary file read via redirect mock) | moderate | 4.1.9 | direct devDependency | dev-only | `dev: true`. Affects the test runner only. | 4.1.11: **direct** (`^4.1.8` admits it). |
| @vitest/mocker | GHSA-82fw-gwwq-j7x9 | moderate | 4.1.9 | vitest > @vitest/mocker | dev-only | `dev: true`. | Comes with the vitest bump. |

## Recommended action, by real exposure

1. **Runtime: nothing to do.** Zero advisories reach the served app or client bundle.
2. **First move (one lock-only refresh, no `package.json` change):** `npm update vitest undici js-yaml
   browserslist baseline-browser-mapping nanoid source-map-js brace-expansion`, then run the merge gate and
   `npm audit`. The patched versions should sit inside the existing ranges (postcss asks
   `nanoid ^3.3.16`, `source-map-js ^1.2.1`; vitest `^4.1.8`), but that was not run here: the operator
   confirms. Expected to clear 8 entries (vitest, @vitest/mocker, undici, js-yaml, browserslist,
   baseline-browser-mapping, nanoid, source-map-js), and `brace-expansion` (9) if the nested copies move;
   otherwise add an `overrides` entry for it. That covers the whole build-time class.
3. **Leave to upstream:** braces/micromatch/fast-glob/@next/eslint-plugin-next/eslint-config-next (no
   patched braces exists) and prisma/@prisma/config/deepmerge-ts (prisma 7.10.0 still pins 7.1.5). Both are
   dev-only and parse repo-owned inputs. Do **not** run `npm audit fix --force`: its suggestions are
   major-version downgrades of eslint-config-next and prisma.
4. Re-run `npm audit` after the refresh. Expected remainder: 8 dev-only entries (the braces chain of 5 and the prisma chain of 3), all upstream-blocked.
