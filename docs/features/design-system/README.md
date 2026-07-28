# Marketing Site & Design System

UI primitives, the component deck, landing-page prototypes, and the marketing
About page.

Context-map group: **Marketing Site & Design System** (`feature`).

> **Status: not yet documented.** No doc exists for this group. The pointers below
> are the current map.

## Implementation roots

| Surface | Route(s) | Source |
| --- | --- | --- |
| Design System: UI Primitives & Deck | — | `src/components/ui/**`, `src/components/deck/**`, `src/components/ConfirmAction.tsx` |
| Landing Page Prototypes | `/` | `src/components/landing/**` |
| Marketing About Page | `/about` | `src/app/about`, `src/components/about/**` |

## What a doc here should cover

- The primitive inventory in `src/components/ui/` and when to reach for each.
- The `Tile` → `TILE_LEDGER` hairline-chrome convention (`Tile` does not
  self-border) used across org pages.
- How landing prototypes are staged behind a tab switcher and what promotes one
  into the brand system — see the `/prototype` skill.
- The 300-LOC-per-`.tsx` ceiling from [`AGENTS.md`](../../../AGENTS.md) and the
  co-located-extraction pattern it prescribes.
