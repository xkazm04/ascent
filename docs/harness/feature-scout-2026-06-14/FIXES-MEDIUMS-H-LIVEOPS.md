# Feature Scout Fix — Mediums Wave H · Live-ops & standard polish (complete: 5/5)

> The polish tail: a live map, celebration sound, a zero-setup demo, and two AI-Native-standard
> upgrades. 1 additive migration. Baseline preserved: `tsc` 0; **vitest 458/458**; eslint 0;
> `next build` ✓ (EXIT 0).

## Commits

| Finding | Commit | What shipped |
|---|---|---|
| MAP #6 — live auto-refresh | `3832649` | A visibility-gated 90s interval re-pulls each org's repos and patches stars in place via `mergeStars` (unchanged stars keep identity → no whole-map re-animation); yields to an in-flight manual scan. |
| WARROOM #5 — celebration sound | `e356cd3` | A default-off "Sound" toggle (persisted) plays a short synthesized Web Audio "ta-da" on an AI-Native crossing; gated on the toggle + `prefers-reduced-motion`. No bundled asset. |
| ONB #6 — zero-setup demo | `167f8cf` | A "See an example org report →" CTA in `PickStep` jumps straight to a curated, already-scanned org rollup — for a user with no obvious org to start with. |
| STD #5 — decision/failed-approach memories | `3b402e9` | The generated SKILL.md now prescribes `note failed-approach` / `note decision` (not just `note progress`) — the high-value institutional memory the standard exists to build. Prompt-only. |
| STD #6 — skill history | `a4a6959` | A `SkillGeneration` table (migration) + best-effort recording on each generation; the report shows an "Onboarding skill" panel with the track set + a diff vs the prior generation. |

## What was fixed

- **MAP #6 — a living map.** `/launch` was a one-shot fetch; scores never moved after load. It now
  refreshes itself while the tab is visible, animating only the stars that actually changed.
- **WARROOM #5 — audible wins.** Crossings into AI-Native were silent; an opt-in chime makes the wall
  feel alive at a glance distance, honoring reduced-motion and browser autoplay rules.
- **ONB #6 — no dead end for the org-less.** A first-time user without a scannable org can now see a
  real cross-repo rollup in one click instead of stalling at the pick step.
- **STD #5 — the memory the standard is for.** `maintain.mjs` always supported `failed-approach` /
  `decision` kinds, but the skill only told agents to log progress; now it captures the non-obvious.
- **STD #6 — onboarding as a tracked program.** A generated skill is recorded (repo, commit, tracks);
  the report surfaces how the onboarding focus shifted over time, complementing the conformance loop.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 458/458 (54 files) |
| `init-sql.test.ts` parity | 30/30 (new `SkillGeneration` model + table mirrored) |
| eslint (changed) | 0 errors |
| `next build` | ✓ EXIT 0 |

## Patterns reinforced

- **Diff before you re-render** (MAP #6): `mergeStars` keeps old object identity for unchanged rows so
  a live refresh doesn't re-trigger entrance animations across the whole field.
- **Synthesize, don't bundle** (WARROOM #5): a Web Audio "ta-da" avoids shipping a binary asset and is
  trivially gated/branched.
- **A zero-setup escape hatch** (ONB #6): point the stuck user at real, already-computed data rather
  than making them produce some first.
- **Persist the one-off to make it a program** (STD #6): a lightweight generation record + a track-set
  diff turns a download into history — surfaced as a sibling of `ReportView` so no component threading.

## What remains (from the INDEX)

Medium Wave F (exec deltas / shareable briefing / exports) + the 4 lows. Stripe (CRED-1/CRED-3) +
notifications/email stay excluded.
