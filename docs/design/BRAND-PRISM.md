# Brand foundation: Prism

Status: **seed for the `/kit` setup track (S2 Gate 0), not yet adopted by the app.** Chosen by the
owner on 2026-09-29 from the `landing-brand` contest (winner A/1, seat `claude-opus-5-5@xhigh`).
Source of truth for the look while the port lands: the contest entry
`.contest/arena/landing-brand/entries/claude-claude-opus-5-5_xhigh/variant-1/` (git-ignored; its
`NOTES.md` is the author's statement). The ported landing is `/?landing=prism`
(`src/components/landing/prism/`) and, once it exists, outranks the contest file as the reference.

## The idea, in one sentence

White light enters a prism shaped like the letter A and leaves as nine lines, one per real
dimension; line width is the dimension's weight. The identity is the product's one act: separate
the evidence so each part can be read on its own.

## Foundations to gate (values as built in the winner)

| Foundation | Prism value | Current app value | Note for S2 |
| --- | --- | --- | --- |
| Canvas | Void `#05060A`, Graphite `#151823`, Ink `#0A0C13` | slate/navy `#080d1a`, `--color-surface #0f172a` | Prism is near-black neutral, the app is blue-tinted slate |
| Text | Paper `#F2EEE6` (warm), mute `#A6ABBD`, dim `#7D8296` | slate-100 family | Warm paper vs cool slate: the largest visible shift |
| Accent | none single accent; the **Spectral Nine** carry colour | one azure `--color-accent #3b9eff` | Conflict to resolve, see below |
| Type, display | system grotesque (Segoe UI Variable Display / SF Pro Display), 300 for statements and 600 for the named thing, tracking -3.5% | Geist Sans | Prism ships no webfont; the app self-hosts Geist via `next/font` |
| Type, mono | Cascadia Mono / SF Mono, only for evidence and file paths | Geist Mono, used for labels and stats | Prism keeps mono for evidence only |
| Body size | `max(17px, 1.22U)`, never below 16 px on desktop | `--text-base` 17px | Already aligned |
| Motion | refraction: one line enters, nine leave; ease `cubic-bezier(.2,.7,.1,1)`; 2.7 s skippable intro | framer-motion, per-surface | `prefers-reduced-motion` gets a calm version |
| Hairline | `rgba(242,238,230,.13)` | `--color-divider #1e293b` | |

The Spectral Nine, in wavelength order, one per dimension:
`D1 #FF5A5F, D2 #FF8A3D, D3 #FFC247, D4 #D4F15B, D5 #62E59A, D6 #38D9D0, D7 #4CB2FF, D8 #7C83FF,
D9 #BC6DFF`. Rule from the winner: **colour is never decoration; it always names a dimension.**

Signature gradient (`--spec`): the nine hues left to right. Used for the primary button's
underline, the progress bar, the eyebrow tick and the wordmark's outgoing beam, nowhere else.

## The mark and wordmark

- **Mark:** an A built as a prism (apex `50,10`, legs 7.5 of 100, open base) with the crossbar as
  the beam: enters at 62% down the left leg, leaves at 52% down the right leg as lines. Nine lines
  at large sizes, five at small, three at 16 px. Clear space is one leg width.
- **Wordmark:** drawn, not typeset. Monoline, 8-unit stroke on a 60-unit x-height, round letters
  overshoot by half a stroke, and the crossbar of the `t` keeps going and leaves the word as light.
- Both exist as SVG `<symbol id="mk">` and `<symbol id="wm">` in the winner's markup. Promote them to
  a shared component with a size prop before any route uses them; the current mark is
  `public/brand/logo-mark-nobg.png` (a raster).

## Illustrative style and honesty

- Custom line-art per dimension (nine scenes) drawn in that dimension's hue; level plates show
  missing evidence as a dark absorption line and found evidence as a bright one.
- The winner labels every invented number `Illustrative` and drawn plates `Stylised`. Keep both
  labels wherever art shows data the page did not measure. No invented scores, repos or counts on
  any route (owner taste: honesty over drama).

## Open conflicts the kit session must decide with the owner (do not decide alone)

1. **Hue vs meaning.** The app already uses red, orange, yellow, lime and green as *level* and
   *status* colours (`levelRamp`, `--color-danger`, `--color-warn`, `--color-success`,
   `--color-tone-*`). The Spectral Nine reuses those hues as *dimension* identity. Two meanings on
   one hue breaks the winner's own rule. Options: dimensions keep the nine hues and level/status
   move to a lightness or shape channel; or the nine hues are landing-only.
2. **Poster scale vs dashboards.** The landing scales on a fixed 16:10 frame (`--U = min(1vw,
   1.6vh)`). Dense org tabs cannot. Decide which of display type, spectral line motifs and
   film-frame composition cross into working surfaces, and which stay on public pages.
3. **Font truth.** System fonts render differently per OS (Segoe on Windows, SF on Mac). Keep
   Geist for the app and use the system stack only where the winner needs it, or adopt the system
   stack everywhere and drop Geist. Measure which fonts actually render before choosing.
4. **Warm paper vs cool slate** across all themes; check `globals.contrast.test.ts` before moving
   any token.

## Where the kit picks this up

`.claude/kit/config.md` (overlay, gates, instruments, visibility order) and `.claude/kit/kit.json`
(instrument config). Start with `/kit init`; this file is S2's draft input, and every owner verdict
at that gate is recorded verbatim in the kit vault's `gates.md`, not here.
