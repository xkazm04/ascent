# Maturity badge

Ascent renders a Shields-style **SVG badge** for any repo so a maturity score (or a
pass/fail gate verdict) can live in a README. The badge endpoint is a cheap, cached,
rate-limited wrapper around a **mock** scan, and a generator page produces ready-to-paste
Markdown / HTML / AsciiDoc snippets.

## Endpoint (`src/app/api/badge/[owner]/[repo]/route.ts`)

`GET /api/badge/:owner/:repo` returns `image/svg+xml`.

**Behavior, in order:**

1. **Normalize + validate** owner/repo (case-insensitive, GitHub name grammar) *before*
   touching cache or scanning — a malformed name returns a neutral "unknown" badge
   immediately.
2. **Per-IP rate limit** — in-memory sliding window, 60 req/min per IP. Over budget →
   static "rate limited" badge + `429` + `retry-after: 60` (never runs a scan on a flood).
3. **Cache** — checks the LLM cache key, then the mock key; on a miss runs
   `scanRepository(..., { mock: true })` and caches under the mock key. A small **negative
   cache** (5-min TTL) absorbs repeated misses for nonexistent repos.
4. **Render** — `cache-control: public, max-age=600, s-maxage=600` (10-min client + CDN).

**Query params:**

| Param | Values | Effect |
| --- | --- | --- |
| `style` | `flat` (default) · `flat-square` · `for-the-badge` | Badge shape. |
| `gate` | `1` | Render a **pass/fail** badge against a gate policy instead of the level. |
| `policy_*` | e.g. `policy_L1=40`, `policy_adoption=50` | Override the gate policy (with `gate=1`). |
| color / logo params | named colors → level hex, or `#rrggbb`; logo as a self-contained `data:` URI only | Styling. External logo URLs are rejected (SSRF-safe). |

When loaded directly (not via `<img>`), the SVG is wrapped in an `<a xlink:href>`
click-through to the report.

## Generator (`src/app/badge/page.tsx`, `src/components/badge/BadgeGenerator.tsx`)

A public landing page wrapping `BadgeGenerator` (client): parse a repo input, show a live
preview, and copy a snippet (Markdown / HTML / AsciiDoc) for all supported params. Snippets
use absolute URLs so they're portable across READMEs.

## Key files

| File | Role |
| --- | --- |
| `src/app/api/badge/[owner]/[repo]/route.ts` | The SVG endpoint: validate → rate-limit → cache → mock scan → render; level + `gate` modes. |
| `src/app/badge/page.tsx` | Generator landing page. |
| `src/components/badge/BadgeGenerator.tsx` | Live preview + snippet copy tool. |

## Known gaps

- Badges always score via the **deterministic mock** provider — fast and keyless, but it
  won't reflect LLM nuance the way a full report does.
- The rate limiter and negative cache are **in-memory**, so they're per-instance, not
  global across serverless instances.
