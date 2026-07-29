# Marketing Site & Design System

UI primitives, the component deck, landing-page prototypes, and the two marketing
decks (`/about`, `/about-org`).

Context-map group: **Marketing Site & Design System** (`feature`).

> **Status: partially documented.** The deck reading scale and the `/about-org`
> deck are documented below; the primitive inventory is still only a pointer map.

## Implementation roots

| Surface | Route(s) | Source |
| --- | --- | --- |
| Design System: UI Primitives & Deck | — | `src/components/ui/**`, `src/components/deck/**`, `src/components/ConfirmAction.tsx` |
| Landing Page Prototypes | `/` | `src/components/landing/**` |
| Marketing About Page | `/about` | `src/app/about`, `src/components/about/**` |
| Marketing Org Page | `/about-org` | `src/app/about-org`, `src/components/about-org/**` |

## The deck reading scale (large-screen typography & measure)

Marketing decks used to stop growing at `lg`: the container was pinned at
`max-w-6xl` (72rem) and every type size sat at its `sm:` step, so a 2560px display
rendered the same 1152px column of 16px body copy as a 1280px laptop — the reading
distance grew, the page did not.

`globals.css` now defines a fluid ramp that components opt into by class:

| Class | Floor (at `lg`) | Ceiling | Used by |
| --- | --- | --- | --- |
| `.deck-h1` | `--h1-floor`, default 3.75rem (`text-6xl`) | `--h1-ceil`, default 5.25rem | masthead headlines |
| `.deck-h2` | 1.875rem (`sm:text-3xl`) | 2.75rem | section titles (`SectionHeading size="page"`) |
| `.deck-lede` | 1.125rem (`text-lg`) | 1.375rem | intro paragraphs |
| `.deck-body` | 1rem (`text-base`) | 1.1875rem | body copy, card blurbs |
| `.deck-figure` | 1.5rem (`text-2xl`) | 2.125rem | mono stat-ledger figures |
| `.deck-container` | 72rem / `px-5` | 92rem / 2.75rem padding | replaces `mx-auto w-full max-w-6xl px-5` |

Rules that make this safe to extend:

- **Everything is inside `@media (min-width: 64rem)`.** Below `lg` nothing changes;
  each floor equals exactly what the element rendered at 1024px before.
- **Ramps are written as `clamp(FLOOR, FLOOR + (100vw - 64rem) * rate, CEILING)`.**
  Writing the growth as a delta from the floor makes the breakpoint continuous for
  *any* floor, which is what lets one `.deck-h1` rule serve both mastheads via the
  `--h1-floor` / `--h1-ceil` custom properties (`[--h1-floor:3rem]` etc.).
- **Unlayered rules beat Tailwind utilities.** Tailwind v4 emits utilities into the
  `utilities` cascade layer, so `class="text-4xl sm:text-6xl deck-h1"` keeps the
  small-screen steps and takes the ramp from `globals.css`. Restate `line-height`
  in any new ramp — the utility's own line-height survives otherwise.
- **No root `font-size` trick.** It was tried; `html.snap-deck` is added in an
  effect *after* mount, so every large screen visibly re-typeset itself once
  hydration landed.
- **Vertical rhythm in a `min-h-screen` hero keys off viewport HEIGHT, not width**
  (`[@media(min-height:60rem)]:mt-16`). A hero fills a 1080p viewport almost
  exactly, so adding air at a `2xl` *width* breakpoint pushes the stat ledger under
  the fold, where `overflow-hidden` silently clips it.

## Scroll & canvas

- **`DeckProgress`** (`src/components/deck/DeckProgress.tsx`) — a 2px accent rule at
  the top of the viewport that fills as the deck is descended. Pure CSS via
  `animation-timeline: scroll(root block)` behind an `@supports` guard: no scroll
  listener, no rAF, no per-frame React work. Rendered by all three deck
  orchestrators.
- **The canvas wash moved off `body`'s own background** into a fixed `body::before`.
  `background-attachment: fixed` forced a main-thread repaint of a 70rem radial
  gradient on every scroll frame and blocked compositor promotion.
- **`html.snap-deck body::after`** paints a ~3% fractal-noise paper grain (fixed,
  180px tile). Scoped to the marketing decks — the org dashboard is a dense data
  surface where even 3% noise is texture the reader has to look past.
- **`html { scrollbar-gutter: stable }`** stops the sideways reflow when a modal
  locks scroll; **`html.snap-deck { overscroll-behavior-y: none }`** stops the
  rubber-band at both ends of a deck fighting the snap.
- **`.tick-corners`** — four hairline registration marks drawn as eight 1px
  background slivers, so it can sit on any panel without an extra element. Claims
  only `background-image`, so a panel's `bg-surface/40` is untouched.

## `/about-org` — the organization edition deck

Eight snap sections: masthead · the five questions · the module map · three
feature deep-dives (practices, memory & skills, governance) · the operating loop ·
CTA. It shares `DeckSection` / `DeckNav` / `Reveal` / `AboutFeature` /
`AboutCtaButtons` / `GlowBackdrop` with `/about` rather than forking them.

**The module map is derived, not authored.**
`src/components/about-org/orgModules.ts` builds the six module groups from
`ORG_NAV_GROUPS` (`src/lib/org/orgTabs.ts`) — the same constant the shipping rail
renders — and every href from `orgTabHref`. The only thing the file adds is one
sentence per view, keyed by `OrgTabId`. So a renamed tab flows through
automatically, and an **added** tab fails `orgModules.test.ts` (which pins that
every tab in `ORG_TAB_IDS` has a blurb) instead of silently going unmentioned. The
masthead's "6 modules / 21 views" figures are derived from the same source, so the
copy cannot contradict the map below it.

**Every diagram states a real constraint.** `PracticeCascade` caps its run at the
same 25 repos/call `POST /api/practices/apply-batch` enforces; `KnowledgeLedger`
renders `MEMORY_KIND_LABEL` and `usageVerdictLabel` / `DORMANCY_WINDOW_DAYS` from
the product's own modules rather than invented vocabulary.

**The module tabpanels are all rendered and hidden with `visibility`,** stacked into
one grid cell (`col-start-1 row-start-1`). That keeps the panel as tall as the
tallest module (no layout shift under a scroll-snap reader), avoids a bare
`bg-divider` block where a module's view count doesn't fill the last grid row, and
ships all 21 views in the server HTML for crawlers.

## What a doc here should still cover

- The primitive inventory in `src/components/ui/` and when to reach for each.
- The `Tile` → `TILE_LEDGER` hairline-chrome convention (`Tile` does not
  self-border) used across org pages.
- How landing prototypes are staged behind a tab switcher and what promotes one
  into the brand system — see the `/prototype` skill.
- The 300-LOC-per-`.tsx` ceiling from [`AGENTS.md`](../../../AGENTS.md) and the
  co-located-extraction pattern it prescribes.
