# Feature Scout Fix — App Shell SEO mediums/low (complete: 3/3)

> SHELL-3, SHELL-4, SHELL-5 closed on `master` — the last open findings in the App Shell, SEO &
> Error Pages context. With SHELL-1/2 done in Wave 8, that context is now **5/5**.
> Baseline preserved: `tsc` 0; **vitest 456/456**; eslint 0; `next build` ✓ (EXIT 0).

## Commits

| Finding | Sev | Commit | What shipped |
|---|---|---|---|
| SHELL-3 | Medium | `a006d45` | `src/app/manifest.ts` — installable PWA shell: name/short_name, `display: standalone`, `#080d1a` theme/background, brand-mark icons (transparent for `any`, filled for `maskable`). + `appleWebApp` metadata (in `b5e5f2b`). No service worker. |
| SHELL-4 | Medium | `b5e5f2b` | A shared `publicBaseUrl()` helper → `metadataBase` (OG/icon URLs resolve absolute), site-wide **Organization + SoftwareApplication** JSON-LD in the layout, and a **FAQPage** on the homepage — all rubric/copy-derived so they can't drift. |
| SHELL-5 | Low | `546e1e7` | Sitemap lists the public marketing/entry routes it omitted (`/badge`, `/pricing`, `/connect`, `/onboarding`) and routes its base URL through `publicBaseUrl()`. |

## What was fixed

- **SHELL-3 — Installable shell.** Ascent had no Web App Manifest, so it couldn't be installed (Add to
  Home Screen / desktop) and showed generic chrome. A `MetadataRoute.Manifest` plus `appleWebApp`
  metadata gives it brand chrome on the splash/task switcher. Icons reuse the existing brand marks;
  `sizes:"any"` is declared honestly (single source PNGs, not a pre-rendered 192/512 set), and the
  filled mark fills the `maskable` slot so Android's safe-zone mask doesn't clip a bare glyph.
- **SHELL-4 — Structured data + absolute metadata base.** No JSON-LD meant no rich results / knowledge
  panel, and a missing `metadataBase` left OG/icon URLs relative (unfurlers want absolute). Added
  Organization + SoftwareApplication graph (layout) + a FAQPage (homepage), built from the same
  `LEVELS`/`DIMENSIONS` + on-page method/pricing copy the page renders, so the structured data can
  never disagree with the visible content. `metadataBase` is set only when a public origin is
  configured (else Next falls back gracefully).
- **SHELL-5 — Complete sitemap.** Public, indexable routes (`/badge`, `/pricing`, `/connect`,
  `/onboarding`) were reachable only by link-following. Listed them; the base URL now comes from the
  shared helper so the sitemap, JSON-LD, and `metadataBase` can't diverge on origin.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 456/456 (54 files) |
| eslint (changed) | 0 errors |
| `next build` | ✓ EXIT 0 — `/manifest.webmanifest`, `/sitemap.xml`, `/robots.txt` emitted |

## Patterns reinforced

- **One source for the public origin** (SHELL-4/5): `publicBaseUrl()` replaces a 5×-copied env
  expression for the metadata routes, so absolute URLs can't drift between sitemap / metadataBase /
  JSON-LD. (The API/email copies in webhook/digest/scan-alerts are left for a later sweep.)
- **Derive structured data from the rubric, not a parallel copy** (SHELL-4): the JSON-LD level/dimension
  counts and FAQ answers are generated from `LEVELS`/`DIMENSIONS` + the on-page copy, so search snippets
  stay in lockstep with what the page shows.
- **Declare icon sizes honestly** (SHELL-3): `sizes:"any"` for single source PNGs rather than claiming a
  192/512 set that doesn't exist.

## What remains (from the INDEX)

Stripe (CRED-1/CRED-3) · notifications/email (excluded by the user) · 49 mediums / 4 lows (across the
other contexts). The App Shell / SEO context is now fully closed (5/5).
