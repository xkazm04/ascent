# English copy style (ascent)

The rules are the registry's `localization/english` subject (rule IDs `EN-*`); this file is the
house delta only. The contract the checker enforces is `docs/i18n/copy-contract.json`.

## Declared mechanics

| mechanic | declared | rule | decided |
| --- | --- | --- | --- |
| Variant | US English | EN-VARIANT, EN-SPELLING | 2026-09-14, operator, fleet-wide |
| Em dash | banned in product copy | EN-DASH | 2026-09-14, operator, fleet-wide |
| Heading and button case | sentence case | EN-CASE | 2026-09-14, from the count (0 of 41 Title Case) |
| Double quotes | straight | EN-QUOTES | 2026-09-14, from the count (42 straight, 8 curly) |
| Ellipsis | the character | EN-ELLIPSIS | 2026-09-14, from the count (2 char, 0 dots) |

A banned em dash becomes a colon, parentheses, a comma or a full stop, by sense. Out of scope:
the standalone no-data placeholder glyph (a table cell meaning "no value") and code comments.

## House rulings

- **2026-08-14 em-dash sweep, now a gate (2026-09-14).** `scripts/check-em-dashes.mjs` was the
  unwired reporter for that sweep. The `copy:check` gate supersedes it for rendered copy; the
  reporter is kept for docs prose, which the gate does not read.
- **Runtime model prose is not static copy.** Report prose generated at runtime is governed by
  the prompt rule and the `deEmDash` fallback in `src/lib/llm/prose.ts`, not by this contract.
  Its sources are deliberately absent from the contract.
- **Operator-facing mail is out of scope.** `src/lib/email/alert-sink.ts` and
  `plan-enquiry.ts` go to the operator; the transports (`resend`, `ses`, `noop`) hold no copy.

## Sources

Landing (`src/components/landing/**`), about, pricing, the home, about, about-org, pricing,
privacy and terms routes, root layout metadata, `src/lib/site.ts`, and the user-facing mail
builders (`src/lib/email/{index,invite,render,unsubscribe}.ts`). Tests excluded.

## Adoption counts (2026-09-14)

Checked 410 strings (275 fragments) in 58 files from 15 sources. Errors 31: EN-DASH 29
(34 em dashes, five strings carry two), EN-SPELLING 2 (`cancelled`, `Cancelling` in terms).
Warnings 3 (EN-QUOTES). All 31 errors are baselined in `.ai/copy-baseline.json` as debt, drained
separately. Two baselined EN-DASH findings are extractor false positives, not copy: the
`aria-hidden` placeholder glyph joined with its `sr-only` label (`creditMatrixAtoms.tsx`) and a
`console.warn` message (`src/lib/email/index.ts`).

## The gate

`npm run copy:check` runs the whole catalog against the baseline: exit 1 only on a new error.
`.githooks/pre-push` runs it inside the master gate, after `npm run verify`. It is not in
`verify`, which must equal CI's blocking set, and CI has no checker. The checker is a gitignored
link made by `ai-registry/scripts/link-registry.mjs`; without it the hook prints that the copy
gate was SKIPPED and continues. `ASCENT_SKIP_GATE=1` skips the copy step with the rest of the gate.

Escape hatch: a deliberate exception is made visible, never bypassed. An intentional string goes
into the baseline in its own commit whose message says why (`copy:check -- --baseline write`);
a rule wrong for this catalog is turned `off` in the contract with the reason recorded here.
Never `--no-verify`.
