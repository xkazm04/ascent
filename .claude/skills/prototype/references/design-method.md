# The method — how a round is designed (v4)

`design-excellence.md` says what excellent looks like. This file says **how to get there**, and it
exists because knowing the bar was not enough: v3 read the baseline's component tree, kept every
sub-panel, and produced a masthead arrangement and a gauge arrangement of the same experience,
then scored itself 19/20. The tree was the trap. A layout can only rearrange what is already in it.

Everything below is distilled from how design-led teams actually work — Shape Up's breadboarding
and "epicenter first", Amazon's working-backwards press release, content-first design, Linear's
opinionated-defaults craft, Figma's critique-vs-feedback split, Pixar's plussing, and the findings on
why LLM-generated UI regresses to the mean (it averages every interface it has seen; the antidote is
a **named** reference and **declared** constraints).

---

## 0. The order of operations is the method

The steps happen in this order and the early ones are done **without opening the baseline's
component files**. Read the data types and the route; do not read the panels. If you already know
the panels from an earlier round, write the content outline first anyway and check it against them
afterwards — the outline must not be derived from them.

---

## 1. Name the epicenter (one sentence)

Who reads this screen, in what moment, to decide what. No component nouns allowed.

> "A tech lead opens this between loop runs to decide whether the last run earned another one."

The epicenter is the ONE element the screen exists for. Everything else is scaffolding for it, and
scaffolding is what gets deleted first. If two candidate epicenters compete, that is two variants.

## 2. Write the press quote (one paragraph)

Working backwards: a short fictional quote from a **named persona** describing what changed for
them once this screen exists. If the quote does not excite that person, the idea is reworked before
any file is touched. This is where "make it better" becomes a promise the design can be held to.

## 3. Write the content outline — words before containers

A plain-text list of every sentence and number the screen will say, **ranked by importance**, in the
reader's language, with zero layout or component vocabulary (no card, panel, tile, gauge, masthead,
grid, sidebar, chip). Include the sentences the screen says at zero data and on error. Numbers carry
units and comparisons ("62, up 4 since kickoff"), not field names.

The outline is the design. Two variants that share an outline and differ in layout are one design.

## 4. Breadboard — places, affordances, connections

Shape Up's fat-marker sketch as text: each *place* the reader can be, the *affordances* there, and
which place each affordance leads to. Still no visual vocabulary. This is where progressive disclosure
gets decided (what is one interaction deeper) and where dead affordances show up (a control leading
nowhere the reader needs).

## 5. Choose the reference product and declare the axioms

**Reference:** one real product, by name, and precisely what is borrowed — a density, an empty-state
treatment, a table's expansion behaviour, a delta presentation. "Inspired by modern dashboards" is
forbidden; that phrase is the average of everything. Good references for ascent's surfaces: Linear
Insights, Vercel Analytics, GitHub's security overview, Datadog's service page, Bloomberg's density,
Felton's annual reports, Stripe's radar, Grafana's stat panel.

**Axioms** — five values declared before generation, so taste is a constraint rather than a knob:
1. density (compact 32px / comfortable 40px / spacious 48px row rhythm),
2. type contrast (ratio between the focal size and body, e.g. `type-figure-lg` over `type-body-sm`),
3. colour saturation (mono-only / one accent role / accent + level ramp),
4. shape (hairline ledger / soft surfaces / bare text on ink),
5. motion timing (none / 150ms state / 280ms arrival).

**Two variants may share at most one axiom value.** This, not the layout name, is what forces
divergence.

## 6. Make the variants differ on an axis of meaning

Before naming variants, pick the axis each one moves on. Layout is not an axis. These are:

- **Change the reader.** A VP between meetings (one verdict, one arrow, nothing else without a
  click) versus the tech lead about to run a sprint (a ranked worklist by effort; the score they
  already know is omitted).
- **Change the unit of analysis.** Per-dimension → per-repo, per-run, per-practice, or per-trend
  (a screen that only shows what moved, never the absolute).
- **Change what the screen is FOR.** Monitoring ("is anything on fire" — glanceable, binary) versus
  deciding ("which of these three paths do we fund" — a comparison, no gauges) versus persuading
  ("convince the board we are climbing" — one hero number, one annotated line, everything else cut).

A variant is named after its **idea** ("Earned another run", "What moved this quarter"), never after
a layout noun.

## 7. Build the epicenter first, alone

Prototype only the epicenter element at real fidelity — real props, real type scale, real empty
state — before anything is assembled around it. If the epicenter is not obviously better than the
baseline's answer to the same question, stop; the round is not ready to widen.

## 8. Assemble, then the deletion pass

Assemble the rest around the epicenter from the outline and the breadboard. Then the pass that
v3 never ran: **delete at least one thing the baseline had, and say why it did not survive.** The
deliverable of this step is the deletion list, written into the round summary. "What would a
senior designer at Linear remove?" is the only question asked here; nothing is added.

**Forbidden in a variant:** importing the baseline's sub-components (`OrgScoreBadges`,
`OutcomeRow`, …); carrying a baseline panel over unchanged "for completeness"; a name that is a
layout noun.

## 9. Render, then critique adversarially — never score your own work

Render the variant (dev server + a screenshot at 1440px via the browser tools when available; a
jsdom render is the fallback) and hand the **screenshot**, the epicenter sentence, the outline and
the reference product to a **separate critic** — a subagent with an adversarial mandate, not the
builder re-reading its own JSX. The critic's brief:

1. Is the epicenter answerable in three seconds from the pixels? (Falsifiable: yes / no, and where
   the eye went first.)
2. Why is this still generic? Name the three moves that make it look like every dashboard.
3. Does it beat the named reference product for THIS reader's job? Verdict, not a number.
4. The subtraction list: what to remove, in order. Additions are not accepted in round one.
5. Only then the §3 rubric from `design-excellence.md`, as a floor (16/20, no zero), never as the
   headline. A rubric number is easy to flatter; a verdict against Linear is not.

The builder fixes what the critic found, re-renders, and the round summary quotes the critic's
verdict and the deletion list verbatim beside each variant. The user reads a critique, not a score.
