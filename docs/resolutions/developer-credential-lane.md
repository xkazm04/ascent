# Resolution C22: the developer-held credential lane (user-to-server GitHub tokens for UC3)

_Status: **concept — decision pending**. Written 2026-08-29 against the working tree at `42c7b12e`
(moonshot deck item **#22**, gate `policy`). Every `file:line` below was re-read; where the finding's
premise was stale it is corrected in §1. This is a **threat model first**: a third credential lane is
a new class of secret at rest, and the reason it needs a doc before code is that the failure modes are
security failures, not product ones._

---

## 0. The question

UC3 promises the developer a view of themself that is *private-first, never surveillance*. Today the
product can only keep that promise by **policy**: every byte the Developer route shows was read with
the **org's** installation token, so the org's credential can, in principle, read everything the
developer sees. Deck item #22 proposes making the promise **structural** — the developer's own GitHub
credential reads the developer's own activity, and the org's credential structurally cannot reach it.

That requires (a) switching the Supabase GitHub provider to the Ascent App's OAuth client so
`provider_token` becomes a *user-to-server* token, (b) persisting that token — the first per-user
secret Ascent would ever store — and (c) a third lane in credential resolution. Each of those is a
decision the owner should take deliberately, because each is reversible only at a cost:

1. the provider switch changes the **login** flow for every existing user;
2. persisting user tokens changes Ascent's **breach blast radius** from "org installation tokens,
   short-lived, mintable-only-with-the-App-key" to "N developer identities, refreshable";
3. a third lane makes "which credential read this row?" a question every GitHub call must answer, and
   a wrong answer is a privacy incident rather than a bug.

---

## 1. Ground truth in code today

**Premises that held.**

- `provider_token` is used **once and discarded**. `src/app/auth/callback/route.ts:98` reads
  `data.session.provider_token`; `:102` hands it to `discoverOrgsForLogin` inside `after()`. Nothing
  persists it. `provider_refresh_token` appears **nowhere** in `src/` (grep: 0 hits outside test
  fixtures for `provider_token`, none at all for the refresh token).
- **`/user/installations` is unavailable**, and the code says why:
  `src/lib/auth-discovery.ts` module header — "Supabase issues a token from ITS OAuth client, so
  `/user/installations` is not available there". `docs/features/github/auth.md:191-192` repeats it as
  a Known gap: installation linking "**cannot** simply be ported: it needs an App-client token, which
  Supabase's `provider_token` is not."
- **The viewer's installations come from the DB, not from GitHub.** `viewerInstallations()`
  (`src/lib/viewer-installations.ts:38-42`) falls back to `getViewer()` → `listOrgsForLogin()`; an org
  the developer belongs to but never installed on is invisible.
- **Credential resolution knows exactly two lanes.** `resolveScanAuth`
  (`src/lib/scan.ts:115-152`) returns an installation token or nothing, with a deliberate refusal to
  fall back to the ambient `GITHUB_TOKEN` when the mint gate denies (`:137`, `:143`, `:150`) — the
  operator PAT is treated as *more* privileged than the installation token, which is the right
  instinct and the exact instinct a user lane must not violate.
- **The Developer route reads org-scanned data.** `getDeveloperView`
  (`src/lib/org/developer-view-load.ts:29-46`) is the viewer's slice of `getContributorInsights` plus
  `getOrgBacklog`, exactly as `docs/REGISTRY-AND-CARE-IMPL.md` §5.4 specifies. Under the champion
  floor it honestly degrades to empty.
- **No `UserCredential` model exists** (grep over `prisma/` and `src/`: 0 hits), and **no
  `github_app_authorization` webhook handler exists** (0 hits in `src/`) — so GitHub's own
  "user revoked the App" signal is currently unreceived.

**Premises corrected.**

- **C1 — envelope encryption already exists; do not design a new one.**
  `src/lib/crypto/secret-box.ts` is AES-256-GCM with a versioned `v1:` prefix, keyed on a base64
  32-byte `ENCRYPTION_KEY`, `isEncryptionConfigured()` at `:29`, and it **fails closed**: the BYOM
  path refuses to store a secret when the key is absent (`src/lib/db/org-llm.ts:123,135`). The user
  lane inherits this verbatim, including the fail-closed rule. The finding's "envelope encryption"
  step is therefore *reuse*, not build.
- **C2 — the App's OAuth client id/secret are already named env vars.** `GITHUB_OAUTH_CLIENT_ID` /
  `GITHUB_OAUTH_CLIENT_SECRET` (auth.md's "dormant" stack) are, per `auth-discovery.ts`, "the Ascent
  GitHub App's OWN OAuth client". The provider switch does not need new secrets in the deployment; it
  needs the **same pair** pasted into the Supabase dashboard. That also means the dormant custom stack
  and the Supabase stack would, after the switch, share one OAuth client — which is a fact the
  revocation design must account for (T5).
- **C3 — Supabase will not refresh the provider token for us.** `provider_token` /
  `provider_refresh_token` are returned **only at exchange time**; a Supabase session refresh (which
  `src/proxy.ts` performs on every request) does not re-issue them. So there is no "read it again
  later" path: either we persist at `/auth/callback` or we never have it. This is the single fact that
  forces a stored secret and therefore forces this document.
- **C4 — one of the three Known gaps #22 claims to delete is already half-closed.**
  `POST /api/auth/revoke-sessions` (`src/app/api/auth/revoke-sessions/route.ts`) already works on the
  Supabase stack via `signOut({ scope: "others" })`; only its *render gate* on `/onboarding` is
  missing. #22 should not claim that gap; it should add credential revocation to the route that
  already exists.

---

## 2. Threat model

Assets: (A1) the stored user access token, (A2) its refresh token, (A3) `ENCRYPTION_KEY`, (A4) the
per-user data the lane reads, (A5) the org's belief that it cannot see A4.

| # | Threat | Today | With the lane | Mitigation that must ship *with* it |
|---|---|---|---|---|
| **T1** | **DB read → durable GitHub access.** A dump of `UserCredential` yields live tokens for N developers, including repos in orgs Ascent never installed on. | not possible (no per-user secret at rest) | the headline new risk | `encToken`/`encRefresh` via `secret-box` (`ENCRYPTION_KEY` is **not** in the DB); fail closed when `isEncryptionConfigured()` is false — with no key the lane does not exist rather than storing plaintext; never `SELECT *` the table into a wire type; decrypt only at fetch-construction time, mirroring `org-llm.ts` discipline. |
| **T2** | **Key + DB compromised together** (same host, same env). | n/a | app-level encryption buys nothing | Accept and state it: the mitigation is **blast-radius reduction, not prevention** — request the *minimum* App user permissions, keep the 8-hour expiry (do **not** disable token expiration on the App), and make revocation cheap (T5) so a rotation is a `DELETE` + a forced re-consent, not an incident. |
| **T3** | **Refresh correctness.** GitHub App user tokens expire in 8h; refresh tokens are **single-use and rotating** (6-month life). Two concurrent requests refreshing the same row race: one wins, the other persists a refresh token GitHub has already invalidated → the developer is silently signed out of the lane. | n/a | new | Refresh is a **single serialized writer**: a conditional update keyed on the row's current `refreshHash` (compare-and-set), loser re-reads instead of re-refreshing. Refresh only on 401 or `expiresAt - 5 min`, never opportunistically. On refresh failure: mark `revokedAt`, **never** fall back to another lane (T6). |
| **T4** | **Lane confusion / privilege escalation.** A call meant for the user lane silently runs on the installation token (or the ambient PAT), so the org's credential reads what the developer authorized — or the reverse, a user token reads an org surface and org data is attributed to a person. | n/a | the core correctness risk | Every GitHub read carries an explicit `credential: "user" \| "installation" \| "ambient"` and the resolver **never substitutes**: a user-lane call with no valid user credential returns *no data*, exactly as `resolveScanAuth` refuses the ambient PAT at `scan.ts:137,143,150`. Same refusal, new lane. |
| **T5** | **Revocation that isn't.** The developer clicks "disconnect", the row is deleted, and the token stays live at GitHub for 8h — or the developer revokes at GitHub and Ascent keeps trying. Compounded by C2: after the provider switch, the dormant custom stack shares the same OAuth client, so a GitHub-side revoke kills **both**. | n/a | new | Revoke **at GitHub first** (`DELETE /applications/{client_id}/token`, Basic-auth with the App's client id/secret), then delete the row; report failure honestly rather than claiming success (the pattern `revoke-sessions/route.ts:56-59` already uses). Add a `github_app_authorization` (action `revoked`) webhook handler that deletes the row unprompted. Wire the same deletion into `POST /api/auth/revoke-sessions`. |
| **T6** | **Silent scope creep into the org.** A user-lane read lands in an org-scoped table (`Scan`, `ContributorInsight`, `AuditLog` with an `orgId`, watchlist rows), so data the org could not fetch itself becomes org-visible — breaking A5, which is the whole product claim. | n/a | the claim-breaking risk | A **structural test** (below) asserting that no writer reachable from a user-lane read targets an org-scoped model, plus the runtime rule: user-lane results are written **only** to personal-workspace rows (`Organization.kind = "personal"`, `prisma/schema.prisma:40`) or held in-request. |
| **T7** | **Consent laundering.** A GitHub App user-to-server token's `scope` is advisory; access follows the **App's** permissions (auth.md:180-182). So a developer consenting to "let Ascent show me my activity" grants whatever the App can do, including write permissions the App holds for org repos. | n/a | new, and the most under-appreciated | The privacy ledger must state what the credential *can* reach, not what we intend to use it for; and the lane is **read-only by construction** — `resolveUserToken` is never passed to `src/lib/github/write.ts` / `checks.ts` (asserted by the same structural test as T6). |
| **T8** | **Self-hosted / no-Supabase deployments.** A self-hoster with `authGateEnabled() === false` and no `ENCRYPTION_KEY` has no lane at all. | n/a | must not break | The lane is **absent-by-default and degrades to today's behaviour**: `resolveUserToken()` returns null, the Developer route renders exactly the current org-scanned view with an honest "connect your GitHub account" strip. `selfHosted()` turns plan gates off (`src/lib/env.ts:73-93`) but must **not** turn the credential lane on. |

Residual risk accepted if the lane ships: T2 (key + DB co-compromise) and the fact that Ascent becomes
a holder of developer credentials, which is a compliance posture change (a DSR now has a "revoke my
tokens" limb) even when nothing is breached.

---

## 3. Design options

### Option A — **Do not switch the provider; build the lane on a second, explicit connect**

Keep Supabase's own OAuth client for *authentication*. Add an opt-in "Connect your GitHub account to
Ascent" action on `/org/developer` that runs the App's **own** user-to-server flow (`GITHUB_OAUTH_*`,
already present) and stores the resulting credential.

- **+** Sign-in is untouched; zero risk to the login path (the highest-blast-radius surface in the app).
- **+** Consent is *separate and legible*: the developer opts into the credential, not into logging in.
  This is the honest answer to T7.
- **+** Absence is the default — T8 is satisfied by construction, and every deployment that never
  connects behaves byte-identically to today.
- **−** Two GitHub round-trips for the developer who wants the full view.
- **−** The auth.md Known gaps about installation linking and org suggestions stay open for users who
  never connect (they close only for those who do).

### Option B — **Switch the Supabase provider to the App's OAuth client (the finding's design)**

Paste `GITHUB_OAUTH_CLIENT_ID`/`_SECRET` into Supabase's GitHub provider; every sign-in then yields a
user-to-server token plus a refresh token, persisted in `after()`.

- **+** One flow; `/user/installations`, `/user/orgs` and per-user repo reads become available at
  sign-in, which closes two auth.md Known gaps outright and makes `viewerInstallations()` truthful.
- **−** **Every existing user re-consents** at the next sign-in (a new OAuth client = a new
  authorization). Supabase identities are keyed on the GitHub user id, so accounts survive — but a
  consent screen appearing for the whole user base is a support event that must be planned, not
  discovered.
- **−** Consent is bundled into sign-in: the developer cannot get an account without granting the
  credential. That is precisely the pattern UC3 criticises incumbents for (T7).
- **−** The blast radius becomes *everyone who ever signed in*, not *everyone who opted in* (T1).
- **−** Couples the login path to refresh correctness (T3): a refresh bug is now adjacent to auth.

### Option C — **Provenance-only: stamp the lane, store nothing**

Ship step (3) of the finding alone — a `credential` provenance stamp on every GitHub call plus the
privacy ledger — and keep reading through the installation token.

- **+** Near-zero risk; makes the *current* posture legible ("this row was read with your org's
  credential") and is a prerequisite for A or B anyway.
- **−** Does not make the promise structural. UC3 stays policy-private.

**Against the guardrails and the deck.** None of the three touches G1–G9 (they govern report/PDF and
pricing surfaces). All three must respect the champion floor `CHAMPION_MIN_POP = 3` on the *org* side
— the developer's own unfloored row is legitimate only because it is their own data, and the user lane
does not change that boundary. Fit with accepted items: **#21** (GitHub identity graph + scoped
membership, *deferred*) would consume `/user/orgs` from the same lane — do not build a second
identity resolver; **#23** (OTLP agent-behaviour ledger, also a concept doc) is UC3's *second* sensor
and shares the personal-workspace write rule, so the T6 structural test should be written to cover
both lanes from the start; **#11** (unified LLM meter) is unaffected — the user lane spends GitHub
rate limit, not credits.

---

## 4. Recommendation

**Ship C, then A. Do not ship B as designed.**

The provenance stamp and the privacy ledger (C) are pure gain and unlock the honest version of the
current product this week. The credential itself belongs behind an **explicit, revocable, opt-in
connect** (A): the same technical lane the finding wants, with consent that is separable from login,
a blast radius limited to people who opted in, and a login path that cannot be broken by a refresh
bug. The two Known gaps B would close (installation linking, org suggestions) close *for connected
users* under A, which is the population that cares.

Revisit B only if telemetry shows connect-rate is low enough to make the feature pointless — and if it
is revisited, it is a separate decision with a user-communication plan, not a config change.

---

## 5. Decisions for the owner

1. **Ship the credential lane at all?** → **Yes**, as C-then-A. (No = ship C only; the Developer route
   keeps its honest org-scanned framing.)
2. **A (explicit connect) or B (provider switch)?** → **A.**
3. **Is a stored developer GitHub credential acceptable at all given T1/T2?** → **Yes, with fail-closed
   encryption**; if the answer is no, stop at C — there is no half-measure that stores a token safely
   without `ENCRYPTION_KEY`.
4. **Disable GitHub's 8-hour user-token expiry** (the App setting) to avoid refresh complexity? →
   **No.** Keep expiry + refresh; a non-expiring stored user token is the worst version of T1.
5. **May any user-lane read be persisted?** → **Yes, personal-workspace rows only**
   (`Organization.kind = "personal"`), enforced by the T6 structural test; **never** into `Scan`,
   contributor insights, or an `orgId`-bearing `AuditLog`.
6. **Does the lane get write access (practice PRs on the developer's own repos)?** → **No.** Read-only
   by construction (T7); repo writes stay on the installation token.
7. **Does connecting require a plan?** → **No.** It is a privacy feature; gating it behind a tier
   inverts the argument. Self-hosted unaffected either way (T8).
8. **Audit rows for connect/refresh-failure/revoke?** → **Yes, but org-less** (`AuditLog.orgId = null`,
   `actorId = login`), so a security trail exists without leaking the connection to the org.

---

## 6. Preconditions

- **P1** `ENCRYPTION_KEY` is set on every environment that will offer connect, and the fail-closed
  path is asserted by a test (no key ⇒ connect is not offered, not "stored plaintext").
- **P2** GitHub App settings reviewed and recorded in `github-app.md`: the exact **user** permissions
  the consent screen will show (T7), token expiration **left enabled**, and the callback URL added.
- **P3** The `github_app_authorization` webhook event is subscribed on the App **before** the first
  credential is stored — otherwise the revoke path is one-directional from day one.
- **P4** C4: the `/onboarding` render gate on `SessionControls` is fixed (or the revoke UI moves to
  `/org/developer`), so "disconnect" is reachable under the live wall.
- **P5** A decision on #23's personal-workspace write rule, so the T6 guard is authored once for both.

---

## 7. Write set if accepted (C then A)

**Schema (Director lands; builders never touch `prisma/schema.prisma` / `init.sql` / `db/index.ts`):**

- `model UserCredential { id String @id @default(uuid()) · login String · forge String @default("github")
  · encToken String · encRefresh String? · expiresAt DateTime? · refreshHash String? · scopes String
  @default("") · createdAt DateTime @default(now()) · updatedAt DateTime @updatedAt · revokedAt
  DateTime? · @@unique([login, forge]) · @@index([expiresAt]) }` — no `orgId`, deliberately; no FK
  (`relationMode = "prisma"`). No client-facing type declares a `Date` (wire-safe-dates): the wire row
  is `UserCredentialStatus { login: string; connectedAt: string; expiresAt: string | null; scopes:
  string[]; revoked: boolean }` — **and it never carries the token**. Add it to the
  `wire-safe-dates.test.ts` import list.
- `src/lib/db/index.ts` barrel lines for the new module.

**New files:** `src/lib/github/user-token.ts` (`connectUserCredential`, `resolveUserToken(login)`,
`refreshUserToken` with the compare-and-set on `refreshHash`, `revokeUserCredential`) ·
`src/lib/db/user-credentials.ts` (+ `.test.ts`) · `src/lib/github/credential-provenance.ts`
(`type CredentialLane = "user" | "installation" | "ambient"`) ·
`src/app/api/me/github/connect/route.ts` (GET → App user authorize URL, state cookie) ·
`src/app/api/me/github/callback/route.ts` (code → credential, same-origin, `safeNext`) ·
`src/app/api/me/github/route.ts` (`DELETE` = disconnect; same-origin + typed confirm) ·
`src/features/developer/CredentialLedger.tsx` (≤200 LOC, `@/components/ui` `Tile`/`Badge`) ·
`src/lib/db/user-lane-isolation.test.ts` (**the T6/T7 structural guard**: every export of
`user-token.ts` is traced through its callers and asserted to reach no org-scoped writer and no module
under `src/lib/github/{write,checks}.ts`; fails-before by adding a deliberate org write in a fixture).

**Edited:** `src/app/auth/callback/route.ts` (Option A: **unchanged** — this is the point) ·
`src/lib/org/developer-view-load.ts` (user-lane branch + per-field provenance) ·
`src/lib/viewer-installations.ts` (prefer `/user/installations` when the credential exists) ·
`src/lib/scan.ts` `resolveScanAuth` (returns the lane; never substitutes) ·
`src/app/api/app/setup/route.ts` (`github_app_authorization` → revoke) ·
`src/app/api/auth/revoke-sessions/route.ts` (also revoke the credential) ·
`src/lib/db/retention.ts` (`eraseOrgData` sibling: erase a *login's* credential).

**Docs (same turn):** `docs/features/github/auth.md` — new "Developer credential lane" section; delete
the "org suggestions aren't surfaced" gap only if A actually surfaces them; **do not** delete the
installation-linking gap under Option A, narrow it to "unconnected users". ·
`docs/features/org-dashboard/developer.md` — the privacy ledger. · `github-app.md` — P2's permission
row. **Handoff to the Director:** `feature-doc-map.json` needs `src/lib/github/user-token.ts` +
`src/app/api/me/github/**` mapped to `auth.md`, and `context-map.json` needs the lane under
"GitHub OAuth & Session".

**Tests:** extend `src/app/auth/callback/route.test.ts` (assert the callback still persists nothing
under Option A) · new `src/lib/github/user-token.test.ts` (refresh race: two concurrent refreshes, one
CAS winner; 401 → revoke, no lane substitution) · `src/lib/db/user-lane-isolation.test.ts` ·
`src/app/api/org/id-routes-gated.test.ts` unaffected (no `[id]` route added). UAT: re-run **Sam**'s
Developer journey (he is the only Character whose job touches it); Dana/Tomáš unaffected.

---

## 8. Out of scope

- **#21 GitHub identity graph + scoped membership** (*deferred*): teams, auto-RBAC, self scope. This
  doc only notes that #21 must consume `/user/orgs` through this lane rather than build a second one.
- **#23 Agent behaviour ledger (OTLP)** (*concept-doc*): UC3's second sensor. Shares the
  personal-workspace write rule and the T6 guard; its own consent design is its own document.
- **#4 Forge-neutral ingestion**: `forge` is a column here so the lane does not need re-shaping later;
  no non-GitHub credential flow is designed.
- **#1 Governance evidence ledger**: the org-scoped control timeline. User-lane reads must **not** feed
  it (T6).
- Repo **writes** on a user credential (practice PRs authored as the developer) — decision 6 is No;
  reopening it needs a new document.
- The `/mentor` local skill and `POST /api/me/mentor/share` (C2/C3 in `REGISTRY-AND-CARE-IMPL.md` §9):
  the care loop's own data path, unrelated to GitHub credentials.
