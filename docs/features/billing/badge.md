# Maturity badge

Ascent renders a Shields-style **SVG badge** for any repo so a maturity score (or a
pass/fail gate verdict) can live in a README. The badge endpoint is a cheap, cached,
rate-limited wrapper around a **mock** scan, and a generator page produces ready-to-paste
Markdown / HTML / AsciiDoc snippets.

## Endpoint (`src/app/api/badge/[owner]/[repo]/route.ts`)

`GET /api/badge/:owner/:repo` returns `image/svg+xml`.

**Behavior, in order:**

1. **Normalize + validate** owner/repo (case-insensitive, GitHub name grammar) *before*
   touching cache or scanning: a malformed name returns a neutral "unknown" badge
   immediately. The name-grammar predicate (`validRepoNamePart` in `src/lib/badge.ts`,
   character class + no leading/consecutive dots) is single-sourced between this route's
   `validName` (which layers the per-segment length cap on top) and the client
   `BadgeGenerator`'s `parseRepo`, so a name the generator accepts is guaranteed to be one
   this endpoint also resolves, never a snippet that renders "unknown" on paste.
2. **Per-IP rate limit**: in-memory sliding window, 60 req/min per IP. Over budget →
   static "rate limited" badge + `429` + `retry-after: 60` (never runs a scan on a flood).
3. **Cache**: checks the LLM cache key, then the mock key; on a miss runs
   `scanRepository(..., { mock: true })` and caches under the mock key. A small **negative
   cache** (5-min TTL) absorbs repeated misses for nonexistent repos.
4. **Render**: `cache-control: public, max-age=600, s-maxage=600` (10-min client + CDN).

**Query params:**

| Param | Values | Effect |
| --- | --- | --- |
| `style` | `flat` (default) · `flat-square` · `for-the-badge` | Badge shape. |
| `gate` | `1` | Render a **pass/fail** badge against a gate policy instead of the level. |
| `policy_*` | e.g. `policy_L1=40`, `policy_adoption=50` | Override the gate policy (with `gate=1`). |
| color / logo params | named colors → level hex, or `#rrggbb`; logo as a self-contained `data:` URI only | Styling. External logo URLs are rejected (SSRF-safe). |
| `rubric` | a rubric id, e.g. `r8` | The scoring rubric the **snippet was generated under**. See *Rubric pinning* below. |

When loaded directly (not via `<img>`), the SVG is wrapped in an `<a xlink:href>`
click-through to the report.

**Mock-engine honesty:** when the resolved report was scored by the deterministic mock
engine (no LLM), the badge appends a `· demo` qualifier to **both** the label and the
value text (e.g. `63/100 · demo`, `L3 Established · demo`), not just the label, so a
cropped or restyled badge (only the value half surviving) can't present a mock score as a
credible LLM-scored verdict.

**Rubric pinning (the embed-snippet meaning contract):** a badge is a verdict about someone, pasted
into *their* README and seen far more often than the report behind it. The generator therefore pins
the parameters that decide what the badge **means** — the gate's `min_level` (an unpinned bar is one
the badge author never chose, and it moves with the detected archetype) and, since the same argument
applies to a level/score verdict, the scoring rubric: every emitted snippet carries
`?rubric=<SCORING_RUBRIC_VERSION>`.

The pin does **not** freeze the value. Both available failures are dishonest — a frozen badge asserts
an old rubric's verdict forever, an unpinned one silently restates a claim its owner never made — so
the badge keeps rendering the **current** verdict and **discloses** that the bar moved. Following the
same rule as `· demo`, the disclosure lives in the badge **value**, not just the label, because a
cropped badge or a screenshot keeps only the value chip:

- pin **matches** the live rubric → no qualifier; the response is byte-identical to the bare canonical
  badge, so it keeps the long shared CDN TTL and still counts as a README impression;
- pin is **superseded** → the value reads e.g. `L3 Established · rubric r7→r8` (gate: `✓ pass · rubric r7→r8`),
  and the response is `private` and untallied, since its body differs from the canonical badge;
- pin is **malformed** → never echoed into the SVG, and treated as a customization (which also keeps
  `?rubric=<random>` from becoming an unbounded set of canonical, impression-minting URLs).

Re-copying the snippet from the generator re-pins it to the current rubric.

## Generator (`src/app/badge/page.tsx`, `src/components/badge/BadgeGenerator.tsx`)

A public landing page wrapping `BadgeGenerator` (client): parse a repo input, show a live
preview, and copy a snippet (Markdown / HTML / AsciiDoc) for all supported params. Snippets
use absolute URLs so they're portable across READMEs.

## Org badge (`GET /api/scorecard/[owner]/badge`, G7-06)

The organisation-level sibling, drawn by the **same renderer** (`src/lib/badge-svg.ts`, extracted from
the per-repo route so the two can't drift). Same query vocabulary (`style`, `label`, `color`,
`metric=score`), same cache branching, same rate-limit budget, same CVD glyph redundancy, and the same
rule that `?color=` may never repaint a resolved verdict.

Three deliberate differences:

- **It never scans.** The per-repo badge falls back to a fresh mock scan so a README image is never
  broken. An org aggregate has no such contract, and inventing one from a mock would publish a number
  no model produced, so an owner with nothing scored gets a neutral `not scored` badge.
- **Public corpus only.** It reads `getPublicOrgScorecard` (see
  [report.md](../reporting/report.md#the-public-register--org-scorecards-g7-05--g7-06)), which pins
  every query to the public org + `isPrivate:false`. A private repo cannot move it, or even reach it.
- **Provenance is a refusal, not a suffix.** The per-repo badge can honestly say `L3 · demo` because
  that is one repo's own preview. An *average over previews* is not a preview of anything real, so the
  badge renders `preview only` instead of a qualified number.

It links through to `/scorecard/{owner}?ref=badge`, the same attribution tag the repo badge uses.

## Key files

| File | Role |
| --- | --- |
| `src/app/api/badge/[owner]/[repo]/route.ts` | The SVG endpoint: validate → rate-limit → cache → mock scan → render; level + `gate` modes. |
| `src/app/badge/page.tsx` | Generator landing page. |
| `src/components/badge/BadgeGenerator.tsx` | Live preview + snippet copy tool. |
| `src/lib/badge-svg.ts` | The shared SVG renderer + cache-policy vocabulary, used by both badge endpoints. |
| `src/lib/badge.ts` | The client-safe badge contract (styles, report href, `validRepoNamePart`, rubric-pin grammar + qualifier). |
| `src/app/api/scorecard/[owner]/badge/route.ts` | Org-level badge: read-only, public-corpus only, refuses a number when nothing was model-scored. |

## Known gaps

- Badges always score via the **deterministic mock** provider: fast and keyless, but it
  won't reflect LLM nuance the way a full report does.
- The rate limiter and negative cache are **in-memory**, so they're per-instance, not
  global across serverless instances.
