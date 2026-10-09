# A private repo's scan stores no text copied from its files

- **Status:** Accepted (2026-10-08, the day the code landed)
- **Date:** 2026-10-08
- **Deciders:** The operator took the store-versus-claim choice on 2026-10-08. `src/lib/private-scan-store.ts:7-9`
  records it ("change the STORES, not the claim"), as do `:18` ("Exempt local scans") and
  `src/lib/db/private-scan-scrub.ts:1-2` ("Scrub all of it"). This record writes those choices down. It
  adds no decision of its own, and it records two questions as open (below).

## Constraint

The private-repo-scan feature promises that source code is never persisted, only derived scores, and
`/privacy` repeated the promise. The lite council's round 1 on `private-repo-scan` (2026-10-07, at
`537140b3`) found the code stored quoted file text for private repos. `src/lib/private-scan-store.ts:3-10`
names four stores that broke it:

- a verified model claim is rendered into `ScanDimension.evidence` with its verbatim quote;
- the guidance arbiter keeps the rule lines and literal commands it compared;
- the manifest readout keeps `repo.purpose` prose and capability commands;
- the `.ai/memory` mirror copies whole entry bodies.

## Decision

**A private repo's report passes through one pure rule on its way to the database, and no column sees the
original.** `persistScanReport` calls `storableScanReport(input)` first and writes everything from the result
(`src/lib/db/scans-persist.ts:121`; comment at `:117-120`). The caller who ran the scan keeps the full report
(`src/lib/private-scan-store.ts:14`). Introduced in `5aed22ae`. For a private repo the rule elides:

- **Cited evidence quotes.** A claim line keeps its facet, points and path(s) and loses `: "<quote>"`
  (`storableEvidenceLine`, `private-scan-store.ts:56-64`). A second path survives only when it can be located
  unambiguously (`:62`). Analyzer-generated lines pass unchanged (`:58`).
- **Guidance-file rules and commands.** Every node keeps its place but gets `commands: []` and `rules: []`.
  Divergence details become `rule: never vs always` or `<key>: commands differ`. Contradiction sides get the
  quote `…` (`:71-102`). So the section headings survive and the rule text does not. The coherence reading
  survives: nodes, canonical, projection states, contradiction count and paths (`:67-70`).
- **Manifest prose.** Capability commands are emptied, `purpose` and `secretsFrom` are nulled, `placeholders`
  is dropped, and any parse note containing a quote is dropped (`:110-118`).

The `.ai/memory` mirror is the fourth store. It is not scrubbed by this rule: it refuses a private repo at its
own gate (`private-scan-store.ts:9-10`, `src/lib/memory/repo-memory-mirror.ts`).

**Local working copies are exempt.** A public report passes through by identity (`:16`, `:36`). So does a
local one: `if (report.repo.forge === "local") return report` (`:37`). The exemption holds because of how
it is marked and where local mode runs:

- The marker is set at the source. `LocalFsSource` stamps `forge: "local"` and also `isPrivate: true` (the
  latter keeps the mirror gate closed) (`src/lib/local/source.ts:139-148`, `ebd30c53`). It is never inferred
  from the url, because a working copy's url is a github.com url (`private-scan-store.ts:20-21`).
- Local mode exists only on self-hosted deployments, where the operator owns the database, and the loop brief
  (`src/lib/db/lane-brief-read.ts`) needs the quotes (`:21-22`).

**A one-off scrub cleans rows written before `5aed22ae`.** `scripts/scrub-private-scan-content.mts` drives
`src/lib/db/private-scan-scrub.ts` (`a55fcc74`; `c6e6e4b7` made an unreadable evidence value logged, not
silently swallowed). It runs the same pure transforms over `ScanDimension.evidence`, `Scan.guidanceGraphJson`
and `manifestJson`, and deletes mirror and repo-memory rows. It is a dry run by default
(`private-scan-scrub.ts:10`), idempotent (`:11-12`), moves no clock (`:13-15`), lists a value that does not
parse instead of writing it (`:16`), and **lists but does not touch** consolidated `OrgMemory` rows
(`:17-19`). `apply` is refused on a self-hosted deployment, because a stored row does not record whether a
local scan wrote it (`:20-25`).

**The tree cannot show whether the scrub has been applied to any deployment.** It writes no marker in the
repo. Its audit action `data.private-scan-scrubbed` (`:35`) lands in a deployment's own audit table. Whether
a given database has been scrubbed has to be checked there.

**What the product says.** `/privacy` now reads: public reports "may quote short excerpts"; private reports
"store none, apart from the section headings of their guidance files, pull request templates and decision
records" (`src/app/privacy/page.tsx:57-59`; `0e36a782`, `13e5c66d`). The feature docs state the rule, the
local exemption, the kept headings and the scrub (`b122e408`, `52f90a2a`).

## Alternatives that lost

- **Keep the quotes and soften the promise** (change the claim, not the stores). Cheapest. Evidence quotes are
  the audit trail that lets a reader check a score. It lost because the product's answer to "do you keep my
  private code" would become "a bounded amount", which is the claim a private-repo buyer is deciding on. The
  operator chose to change the stores (`private-scan-store.ts:7-9`).
- **Encrypt the quotes at rest, or keep them in a separate table with shorter retention.** Preserves
  evidence for the owner. It lost because the page promises nothing is stored, not "stored safely". An
  encrypted copy is still a copy, and the repo has no key-management surface for per-row secrets. This
  record found no code that argues for it.
- **Truncate quotes to a few words.** Smaller exposure and evidence stays recognisable. It lost because
  "short" is not "none". A truncated line from a secrets file, or a rule, is still file text, and the page
  could not be made true by a length limit.
- **Do not persist private reports at all.** Strongest guarantee. It lost because history, the org
  dashboard, drift, follow-ups and rescans all read stored scans. A private repo would have no standing in the
  product that exists to track it.
- **Scrub at read time and leave the rows alone.** One code path and no backfill. It lost because the
  promise is about what is stored. A read-time mask leaves the text on disk, in backups, and to anyone with
  database access.

The reasons in this section are the author's reading of the code and the operator's one-line decisions. Only
the first alternative has a stated decision behind it; the rest are inferred, and a later record may correct
them.

## Consequences the team accepts

- A private repo's evidence lines read `Model cited <facet> (+n) — <path>` with no quote. A reader sees what
  was claimed and where, but cannot check the claim against the text.
- Guidance-file rule text and commands are not stored for private repos. Practice matching works from
  headings, and a stored contradiction names its two paths with the quote `…`.
- **The rule is a deny-list of fields**, not a property of the database. A new column that copies file text
  is stored unless someone adds it to `storableScanReport`. The persist path (`scans-persist.ts:121`) is the
  one door, and this change adds no test that enumerates the columns.
- Local scans keep their quotes, and the exemption rests on `forge: "local"` being set by the source and
  nowhere else.
- The scrub's `apply` is refused on self-hosted deployments, so a self-hosted database that also holds
  pre-`5aed22ae` private GitHub rows is not cleaned by it.
- Existing deployments stay unscrubbed until the operator runs the script. The tree cannot tell which have.

## Open, not decided

**(a) Model-authored prose is still stored verbatim for a private repo, while `/privacy` says private reports
store no excerpts.** `storableScanReport` rewrites only evidence lines, the guidance graph and the manifest
(`private-scan-store.ts:38-43`). `persistScanReport` still writes `headline`, `strengths`, `risks`
(`scans-persist.ts:525-527`), and each dimension's `summary`, `strengths` and `gaps` (`:573-576`), plus the
roadmap rows (`:580`). Model prose can paraphrase or reproduce file content. This record does not decide
whether it does so enough to matter. Two ways out are recognised; **neither is chosen here**:

1. extend the store rule to those fields (cost: private reports lose their narrative);
2. change the page's wording to say model-written commentary is stored (cost: a weaker claim).

Decided 2026-10-09 by the operator (ask 2a12c1f4): way 2, the /privacy wording discloses the stored
commentary. Page commit: 9a4403a0. Point (b) stays open.

**(b) A private report re-read from the store has lost its quotes, and nothing tells the reader.** The
elision (`ELIDED_QUOTE = "…"`, `private-scan-store.ts:29`) is the only marker, and it appears only in
contradiction sides. Evidence lines simply end at the path. The code at this head has no flag on a re-read
report saying that it is the stored form. The same report looked different when its owner first saw it.

## Citations to add in code (not done here)

The `private-scan-store.ts` header, the `scans-persist.ts:117` comment, the `LocalFsSource` marker at
`src/lib/local/source.ts:139`, the head of `src/lib/db/private-scan-scrub.ts` and the `/privacy` paragraph at
`src/app/privacy/page.tsx:57` should cite this file by name.
