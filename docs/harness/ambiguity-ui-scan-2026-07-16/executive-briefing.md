# Executive Briefing — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 2, Medium: 3, Low: 0)

## 1. Deleted/failed tech-stack resolution silently widens a scoped share/PDF to the WHOLE org
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/app/share/briefing/[token]/page.tsx:94` (also `src/app/api/org/briefing/pdf/route.ts:38`)
- **Scenario**: A share token or PDF URL carries `stack=<key>` so a "Frontend briefing" (or a reseller's per-stack deliverable) stays scoped. Both consumers resolve it via `getTechGroupIdByKey(...).catch(() => null)` — and the resolver itself returns `null` when the group was renamed/deleted or the DB read hiccups. `techGroupId: null` means **no filter**: `buildExecBriefing` silently renders the full-org briefing under the same link. (WIP-dependent: share page is uncommitted user WIP.)
- **Root cause**: `null` is overloaded to mean both "no scope requested" and "scope requested but unresolvable"; the error path fails open to the broader dataset instead of failing closed.
- **Impact**: A recipient who was deliberately given a narrowed view (per-stack, potentially per-client when stacks are used that way) sees whole-fleet numbers — a scope-escalation of exactly the data the owner chose not to share. Contrast: an invalid `segment` yields an empty rollup ("Nothing to show"), so the two scoping mechanisms disagree on failure semantics.
- **Fix sketch**: When `verified.stack`/`sp.get("stack")` is non-null but resolution returns null, render the "Link expired or invalid"-style notice (share) / return 404 (PDF) instead of proceeding unscoped. Keep `null-because-absent` as the only unscoped path.

## 2. Share button reports "Link copied" even when the clipboard write failed — and the link is shown nowhere else
- **Severity**: High
- **Category**: missing-state
- **File**: `src/components/org/executive/BriefingShareButton.tsx:40-45`
- **Scenario**: `navigator.clipboard?.writeText(...).catch(() => {})` swallows every failure, then the UI unconditionally shows "Read-only link copied — expires …". Clipboard writes routinely fail here: Safari revokes transient user activation after the awaited `fetch`, permissions policy can deny it, and `navigator.clipboard` is undefined on non-secure origins (the `?.` makes that a silent no-op too). The minted URL is never rendered as text.
- **Root cause**: Happy-path-only success state; the one artifact the whole flow exists to hand over (the URL) has no visible fallback representation.
- **Impact**: An owner pastes an empty clipboard into an email to a board member and has no way to recover the link short of minting another token (each mint is a new live 7-day capability — silent failure also breeds token sprawl).
- **Fix sketch**: On clipboard failure (or absence), switch to a state that renders the full URL in a read-only input with a manual copy affordance; only claim "copied" when `writeText` resolved.

## 3. An ALL-mock scoring period gets no degradation warning anywhere — the strongest degradation, the weakest signal
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/lib/org/briefing.ts:27-31`
- **Scenario**: `engineMixDegraded` returns true only for a *partial* mock fallback (`mock > 0 && real > 0`). If the live engine failed for the entire period, every surface (exec page, board PDF, shared link, LLM markdown) prints just "Scored by Mock (deterministic) ×8" with **no** "⚠ … not the live model" caveat. The test (`briefing.test.ts:87`) encodes the assumption "all mock = a demo/mock deployment, not a fallback" — but nothing distinguishes a demo deployment from a production quarter where every scan fell back.
- **Root cause**: Deployment intent (demo vs prod) is inferred from the score mix itself; the assumption lives only in a test comment, and an executive reader can't be expected to decode the "Mock (deterministic)" label.
- **Impact**: The most degraded possible quarter (100% synthetic scores) is the one case the honesty machinery — built explicitly so "a board/auditor PDF can't present synthetic scores as authoritative" — stays silent on.
- **Fix sketch**: Make the caveat fire whenever `mock > 0` in a period, with wording split between "some scores" (partial) and "all scores this period used the deterministic mock engine" (total); if demo deployments must stay clean, gate on an explicit demo/config flag, not on the mix shape.

## 4. The board PDF silently drops the "Value this period" / fleet-adoption / movement-scale lines the other two surfaces carry
- **Severity**: Medium
- **Category**: visual-inconsistency
- **File**: `src/lib/pdf/briefing-document.tsx:97` (header claim at lines 1-4)
- **Scenario**: The file's header asserts "the page, the clipboard brief, and the PDF can never disagree", and the codebase repeatedly treats the PDF as the surface "most likely to leave the building unedited". Yet the PDF renders neither `valueRealizedLine` (the renewal-justification the interface docs call out), nor `adoptionRate`, nor the full `movement.up/down/compared` scale line — all present on the exec page and in `briefingMarkdown`. The shared page additionally drops Movement and value-realized. (WIP-dependent: briefing-document.tsx is uncommitted WIP.)
- **Root cause**: New briefing fields (valueRealized, adoptionRate, movement) were threaded into the page + markdown but the PDF/share renderers weren't updated; there is no single section manifest keeping the three renderers honest.
- **Impact**: The audience the "value this period" line was built for (leadership/renewal) is exactly the audience that gets the artifact without it; three "lockstep" surfaces now tell three differently-complete stories from one `ExecBriefing`.
- **Fix sketch**: Add the three lines to the PDF (one `styles.line` each, reusing `valueRealizedLine`) and Movement/value to the share page; add a briefing.test assertion (or shared section list) that a fully-populated briefing renders the same section set across markdown and PDF.

## 5. Frozen-window share links keep a floating "last 90 days" label — the title misdescribes the pinned data
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/app/share/briefing/[token]/page.tsx:82-90` (mint side `src/lib/briefing-share.ts:61-63`)
- **Scenario**: Finding B correctly froze the data window at mint time (`winStart`/`winEnd`), but the page still labels it with `period.title` recomputed from the range key ("Last 90 days" banner + "over last 90 days" description). A board member opening the link on day 6 of its 7-day TTL reads "last 90 days" while the numbers actually cover a window ending 6 days ago; nothing on the page states the mint/as-of instant (the `generatedOn` shown in PDFs isn't rendered here).
- **Root cause**: The clock-drift fix pinned the data but deliberately kept the floating label ("period.title stays the label") — a trade-off recorded in briefing-share.ts but with its user-facing consequence (relative label over absolute data) unaddressed and undocumented on the page itself.
- **Impact**: The precise numbers-vs-label mismatch Finding B was fixing is reintroduced at the presentation layer: the recipient can quote "last 90 days" figures that are provably not the last 90 days, with no visible hedge.
- **Fix sketch**: When `verified.winEnd` is present, render the label as absolute — e.g. "90 days ending {winEnd date}" or append "· as of {winEnd date}" to the read-only banner — keeping the friendly title for legacy (unfrozen) tokens only.
