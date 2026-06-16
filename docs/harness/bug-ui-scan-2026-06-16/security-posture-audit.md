# Security Posture & Audit Log — bug-hunter + ui-perfectionist scan
> Total: 6 (Critical: 0, High: 3, Medium: 2, Low: 1)
> Lens split: bug-hunter 4 / ui-perfectionist 2
> Files read: 10

## 1. Audit-write failures are silently dropped — the "react to failure" contract is dead code
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: audit-log integrity / silent failure
- **File**: src/lib/db/scans-audit.ts:14-40 (callers: src/app/api/org/plan/route.ts:41, src/app/api/org/gate-policy/route.ts:41, src/app/api/org/alerts/route.ts:109/127, src/app/api/org/members/route.ts:50/74, src/app/api/org/invites/route.ts:47, src/lib/db/retention.ts:232/264)
- **Scenario**: A privileged action runs (plan change, member removal, webhook set, retention purge). The `auditLog.create` fails — DB connection blip, pool exhaustion, an over-long `meta` JSON, a transient write error. `recordAudit` catches it, logs to `console.error`, and returns `false`. The action's HTTP response is still `200 ok`. No audit row exists. The actor performed a sensitive change with **zero** trail.
- **Root cause**: `recordAudit` was deliberately built to return `false` "so audit-critical callers can react instead of pretending success" (doc comment, lines 8-13). But a project-wide grep shows **no caller anywhere** inspects the return value — every call site is bare `await recordAudit(...)`, and several (plan, gate-policy, alerts, invites, members) additionally wrap it in `.catch(() => {})`, swallowing even a thrown error. The whole boolean-return mechanism is dead code; the contract is unfulfilled.
- **Impact**: Audit entries can be dropped without anyone noticing in-band. For a compliance-evidence feature ("who did what"), a missing entry is exactly the gap the design claims to prevent. An attacker who can induce intermittent write failure (or simply benefits from one) gets actions that leave no trace, and the CSV "compliance evidence" export will be incomplete with no indication.
- **Fix sketch**: Either (a) make audit writes share the mutation's transaction (the pattern already adopted for `scan.created` in scans-persist.ts:274 and recommendations in scans-recommendations.ts:105 — "the audit row shares the mutation's atomicity, rolls back together"), or (b) honor the existing boolean: have audit-critical callers check `if (!(await recordAudit(...)))` and surface a degraded/207 response or enqueue a retry. At minimum, drop the `.catch(() => {})` wrappers so failures aren't double-swallowed.

## 2. The audit trail is mutable & purgeable — no DB-level immutability or hash chaining
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: audit-log integrity / tamper-evidence
- **File**: prisma/schema.prisma:377-391 (model AuditLog), src/lib/db/retention.ts:225-228 (pruneAudit)
- **Scenario**: The product positions the audit log as "an **immutable** audit log of who did what." But `AuditLog` is an ordinary mutable Prisma table with a plain `uuid` id, a `meta` JSON string, and `at @default(now())`. Anyone with DB/Prisma access (or any future code path) can `auditLog.update`/`delete` a row, rewrite `meta`, or backdate `at`, and nothing detects it. The retention job already deletes rows in bulk (`pruneAudit`, line 227), and an *attacker-controllable* `auditDays` policy could be used to shrink the retention window and purge incriminating entries — the purge is itself the only thing that records it, and per finding #1 that record can silently fail.
- **Root cause**: "Immutable" is asserted in copy but never enforced. There is no append-only constraint, no tamper-evidence (per-row HMAC or prev-row hash chain), no separation between the write path and an update/delete path, and no WORM/retention-lock at the storage layer.
- **Impact**: The core compliance promise ("immutable") is false. Entries can be edited, deleted, or backdated by anyone with write access, and there is no way to prove after the fact that the log wasn't tampered with — defeating the purpose of an audit trail used as evidence.
- **Fix sketch**: Add tamper-evidence: store a per-row HMAC over `(action|orgId|actorId|meta|at|prevHash)` keyed by a server secret, chaining each row to the previous (a Merkle/hash chain). Verify the chain on read/export and flag breaks. Enforce append-only at the DB layer (revoke UPDATE/DELETE on the table for the app role; do retention purges via a separate privileged role + a signed retention receipt). Don't rely on the prose "immutable" claim.

## 3. Supply-chain token/permission failure renders identically to a clean fleet (silent blind spot)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: supply-chain edge case / silent failure
- **File**: src/lib/security/supply-chain.ts:123-149, src/app/org/[slug]/security/page.tsx:120
- **Scenario**: `SUPPLY_CHAIN_PROVIDER=github` is set (live mode). The installation token can't be minted — App lacks "Dependabot alerts: read", install was revoked, or `getInstallationToken` throws (both swallowed by `.catch(() => undefined)`, lines 125-126). `token` is `undefined`, so `githubProvider.fetchAdvisories` returns `null` for **every** repo (line 66). `rows` is empty → `scanned: 0`, all totals `0`. The Security page only renders the Supply-chain card `if (supply && supply.scanned > 0)`, so it shows **nothing** — visually identical to "we scanned and found zero advisories."
- **Root cause**: A fetch/permission failure (`null`) and a genuinely clean repo (`{0,0,0,0}`) are conflated. The provider degrades "quietly" (line 72 comment) all the way up to the UI, which has no error/degraded state — only present-with-data vs absent.
- **Impact**: A security-posture dashboard reports "all clear" when it actually has no data. An org could have many critical advisories and see a blank/absent panel, mistaking a broken integration for a healthy supply chain — a false sense of security on the one screen meant to surface it.
- **Fix sketch**: Distinguish "no data / fetch failed" from "scanned, zero advisories." Track per-repo `null` results (unreachable count) in `OrgSupplyChain`; if the token couldn't be minted or all repos returned `null`, surface a "Supply-chain data unavailable — check Dependabot permission" banner instead of an absent card. Don't gate the card solely on `scanned > 0`.

## 4. Dependabot alert counts are capped at 100 per repo (no pagination → undercount)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: supply-chain edge case / data integrity
- **File**: src/lib/security/supply-chain.ts:68-74
- **Scenario**: A repo has more than 100 open Dependabot alerts. The fetch requests `?state=open&per_page=100` (line 69) and processes only that single page — the `Link: rel="next"` header is ignored. `countAdvisories` tallies at most 100 alerts; the rest, including criticals beyond the first page, are dropped.
- **Root cause**: No pagination loop. `per_page=100` is GitHub's max page size, not a total cap, and the code treats the first page as the complete set.
- **Impact**: Org-level and per-repo severity totals on the Security tab (and in the "Copy for LLM" brief) systematically undercount advisories for the most-vulnerable repos — precisely where the number matters most. A repo with 150 critical advisories may show 100 or fewer, understating risk.
- **Fix sketch**: Follow GitHub's `Link` pagination (or loop `page=1..N` until a short page) up to a sane bound, accumulating counts across pages; or surface a "100+" indicator when a next page exists so the cap is at least visible.

## 5. `org.gate_policy` audit entries render unlabeled and are unfilterable in the viewer
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: filter UX / data-completeness drift
- **File**: src/components/org/AuditLogViewer.tsx:17-36, src/app/api/org/gate-policy/route.ts:42
- **Scenario**: An owner changes the CI gate policy. The backend writes `recordAudit("org.gate_policy", ...)` (gate-policy/route.ts:42). In the viewer, `ACTION_META` has no `org.gate_policy` key, so `ActionBadge` falls through to the raw-string default (line 39) and renders the badge as literal `ORG.GATE_POLICY` in grey. The action also isn't in `ACTION_FILTERS`, so it can't be selected from the "Action" dropdown — you can never isolate gate-policy changes.
- **Root cause**: The `ACTIONS` list (lines 17-30) is hand-maintained and drifted from the actual emitted actions. The header comment (lines 14-16) explicitly claims this list was reconciled to "the audit actions the app actually records" and even calls out a prior drift bug — yet `org.gate_policy` (a sensitive config change) and `org.alerts.webhook`'s sibling `playbook.updated` (playbooks/[id]/route.ts:51) are missing.
- **Impact**: Security-relevant config changes appear as ugly raw identifiers and are invisible to the action filter, undermining the viewer's core job (finding specific governance actions). Contradicts the comment's own "can't drift apart" promise.
- **Fix sketch**: Add `org.gate_policy` (and audit-grep the codebase for every distinct `recordAudit(...)` action literal, including `playbook.updated`) to the single `ACTIONS` source. Better: derive the canonical action list from one shared constant imported by both the recorder call sites and the viewer so they genuinely can't diverge.

## 6. Audit table a11y: no column scope, no busy/live-region during async load, color-keyed severity
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: accessibility / loading state
- **File**: src/components/org/AuditLogViewer.tsx:194-221, 109-125
- **Scenario**: A screen-reader user filters or paginates the log. The `<th>` headers (lines 197-200) lack `scope="col"`, so cell-to-header association is ambiguous. During `load()`, `loading` only toggles a button's text/`disabled` (lines 169, 232) — there is no `aria-busy` on the table/region and no `aria-live` status, so a SR user gets no announcement that results changed or are loading; rows just silently swap. Severity/destructiveness of an action is conveyed mainly by badge color (`text-red-300` for "member removed" vs `text-violet-300` for "invited", lines 25-27) — distinguishable to sighted users but the only cue beyond the short label.
- **Root cause**: Table built for visual scanning without ARIA semantics for the async/filtering interactions, and severity encoded primarily via color class.
- **Impact**: Keyboard/SR users can't reliably read the audit table or tell when a filter applied — a poor experience on a compliance surface that should be broadly auditable. WCAG 1.3.1 (info & relationships) and 4.1.3 (status messages) gaps.
- **Fix sketch**: Add `scope="col"` to the `<th>`s and a `<caption className="sr-only">`; wrap the table in a region with `aria-busy={loading}` and add a visually-hidden `aria-live="polite"` status (e.g. "12 entries shown" / "Loading…"). Keep the existing text label as the primary severity cue (it's already not purely color), but ensure destructive actions have a non-color affordance (e.g. an icon) for consistency.
