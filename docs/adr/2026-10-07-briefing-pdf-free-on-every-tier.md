# The executive briefing PDF is free on every tier

- **Status:** Accepted (2026-10-07)
- **Date:** 2026-10-07
- **Deciders:** The operator, through ask 256fcafb (answered 2026-10-07 09:10Z, option "Keep it free for
  every org"). His note, verbatim: "the executive briefing PDF stays free on every tier, a deliberate
  exception to the report PDF's pro gate. Record it as such." He gave no reasons beyond "a deliberate
  exception". Any reasoning below that is not that sentence is the recording agent's own and is marked
  **(author's reasoning)**.

## Constraint

Two PDF routes sit side by side and enforce different entitlements, and nothing said the difference was
intended. The council on executive-briefing-export (run 968cf4af) flagged it for exactly that reason.

- `GET /api/report/pdf` enforces `planAllowsPdfExport` (`src/app/api/report/pdf/route.ts:51`), exempting
  `PUBLIC_ORG` (`:43`). `pdfExport` is `minPlan: "pro"`, the Starter tier and up
  (`src/lib/plans.ts:129-134`; predicate at `src/lib/plans.ts:527`).
- `GET /api/org/briefing/pdf` checks only `requireOrgRead`
  (`src/app/api/org/briefing/pdf/route.ts:34`). It re-checks the plan once, for white-label branding
  (`planAllowsWhiteLabel`, `:96`).

So the briefing PDF is available to a Free org today. Left undeclared, a reader sees an inconsistency
and has every reason to "fix" it by adding the gate, which would silently take a deliverable away from
Free orgs.

## Decision

The executive briefing PDF is **deliberately outside the `pdfExport` capability** and stays available to
every org that can read its briefing, on every tier. It is a declared exception to the report PDF's
Starter gate, not an oversight. White-label branding on the briefing PDF is unchanged: it stays gated by
`whiteLabel` (Team and up). Nothing in the code changes with this record; comments at the two sites cite
this file.

## Alternatives that lost

1. **Gate the briefing PDF like the report PDF, with the public-org exemption `/api/report/pdf` has.**
   This is the other option the operator was offered. It would make the two PDFs consistent. It would
   cost: Free orgs lose a deliverable they have today (a behaviour change, 403 where there was a
   download), a plan read on a route that currently has none (so a new 503 path for a failed plan read,
   as the report route has), and the `PUBLIC_ORG` exemption would have no meaning here, since the
   briefing is org-scoped. The operator chose against it.
2. **Gate it behind its own capability** (a new `PlanCapability`, say `briefingPdfExport`). This would let
   the tier be set independently. It would cost a new entry in `PLAN_CAPABILITIES`, the plan-card and
   credit-matrix listing, the self-host diff and `plans.test.ts` matrices, plus a pricing decision nobody
   asked for. It would also create a gate whose only job is to be set to "free". **(author's reasoning)**
3. **Leave it undeclared.** This is the status quo that produced the council finding. It costs nothing
   today and recurs: each new reader of the two routes re-discovers the asymmetry, and the first one who
   treats it as a bug ships a paywall the operator decided against.
4. **Fold it into `pdfExport` by redefining the capability as "any PDF".** One rule, no exception. It
   changes the same behaviour as alternative 1, and it contradicts the capability's own copy, "Download
   any saved report as a PDF" (`src/lib/plans.ts:133`), which describes saved reports, not the briefing.
   **(author's reasoning)**

## Consequences accepted

- A Free org can download a board-ready briefing PDF, while the PDF of a saved maturity report needs
  Starter or up. That asymmetry is intended.
- White-label branding on the briefing PDF stays Team and up. A Free or Starter org gets the unbranded
  document; branding is re-checked against the current plan on every download.
- `pdfExport` and `planAllowsPdfExport` describe the saved-report PDF only. A new PDF route must choose
  its entitlement explicitly and, if it is another exception, record it.
- Reversing this (gating the briefing PDF) is a pricing change that takes a new ADR superseding this one.
- **(author's reasoning)** The pricing copy for `pdfExport` ("PDF export", "Download any saved report as a
  PDF") can be read as covering the briefing PDF. It was not changed, since customer-facing copy was out
  of scope; the question was raised in the run's result.
