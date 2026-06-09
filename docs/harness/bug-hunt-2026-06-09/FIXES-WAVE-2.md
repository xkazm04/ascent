# Bug Hunter Fix Wave 2 — Auth, webhook & session integrity

> 5 fix commits, 7 findings closed.
> Baseline preserved: tsc 0 → 0 errors · tests 260/260 → 260/260 · eslint clean.
> Branch: `vibeman/bug-hunt-2026-06-09` (off `master`).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `80eb636` | gh-app #4 (+ enables #1) | Medium | lib/github/app.ts |
| 2 | `61386c2` | gh-app #1 + #6 | **Critical** + Medium | app/webhook/route.ts |
| 3 | `1100f5f` | oauth #1 + #5 | High + Medium | auth/callback/route.ts |
| 4 | `30a93ee` | oauth #3 | Medium | auth/login/route.ts |
| 5 | `04f0df0` | oauth #2 | High | lib/auth.ts |

## What was fixed (grouped by sub-pattern)

### Webhook trust boundary — verify destructive events, fail closed
1. **Forged `installation.deleted`/`suspend` teardown** (`61386c2` + `80eb636`, **Critical**). The destructive webhook branch called `removeInstallation(id)` — which unwatches every repo, nulls `githubInstallId`, and revokes live sessions — trusting `payload.installation.id` blindly, while the *create* branch was already hardened to confirm the account with GitHub. A validly-signed but forged/misrouted delete/suspend naming a victim's still-active installation was a single-delivery DoS. Added `confirmRevocationWithGitHub`: only tear down when GitHub itself confirms it (`deleted` → `getInstallation` 404s; `suspend` → `suspendedAt` set, which required exposing `suspended_at` from `getInstallation`). Any other outcome fails closed.
2. **`installationMatchesOwner` fails open** (`61386c2`, Medium). `.catch(() => null)` on the owner-mapping lookup collapsed "no mapping" and "DB error" into one value, silently downgrading the strict stored-id match to the looser GitHub-confirmation path on any transient DB hiccup. Now fails closed on a thrown lookup error.

### OAuth handshake hardening
3. **Callback ignores GitHub's `error` param** (`1100f5f`, High). A cancelled/expired/suspended authorization redirects back with `error=...` and no `code`, but the handler only checked `!code`, so it surfaced the same generic `error=oauth` as a forged-state CSRF failure — no actionable UX, and benign denials indistinguishable from real CSRF in logs. Now handled first (`error=denied`, logged); the genuine state mismatch gets its own `error=csrf` branch.
4. **Non-constant-time CSRF state compare** (`1100f5f`, Medium). The plain `!==` state check is now a constant-time SHA-256 + `timingSafeEqual` compare (length-independent), mirroring the session HMAC.
5. **State/next/resync cookies lack Secure behind a TLS proxy** (`30a93ee`, Medium). The login route derived Secure from the internal request origin (`http://` behind a proxy), minting the security-critical CSRF state cookie over plaintext. Now single-sourced through `secureCookieForRequest()` (x-forwarded-proto), matching the session cookie.

### Token & session freshness
6. **Installation-token clock-skew expiry** (`80eb636`, Medium). The 60s re-mint buffer covered a token expiring mid-request but not host-clock skew; an NTP-less host running minutes behind real time served tokens GitHub already considered expired (401, no self-heal). Widened to 180s via `TOKEN_EXPIRY_SKEW_MS`.
7. **Silent session re-mint swallowed** (`04f0df0`, High). `getSessionState`'s re-mint `store.set` throws during a read-only Server Component render and the bare `catch {}` swallowed it; a read-mostly surface starves the refresh and abruptly logs out an active user. Added a `needsRefresh` flag to `SessionState`, set on that path, plus a log — making the starvation observable and giving a mutable context a hook to re-mint.

## Verification table

| Gate | After Wave 1 | After Wave 2 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `vitest run` | 260 passed / 260 | 260 passed / 260 |
| `eslint` (changed) | 0 errors | 0 errors, 0 warnings |

## Cumulative status (across all waves so far)

| Wave | Theme | Findings closed |
|---|---|---|
| 1 | Concurrency, dedup & billing integrity | 7 (1 Critical, 3 High, 3 Medium) |
| 2 | Auth, webhook & session integrity | 7 (1 Critical, 2 High, 4 Medium) |
| | **Total** | **14 / 70** (2 of 3 Criticals closed) |

Remaining: 56 of 70. The last Critical (org-dash #1, missing error boundary) is in **Wave 3** (Resilient rendering & empty-data UX).

## Patterns established (catalogue items 5–8)

5. **Verify destructive cross-service events; fail closed** — a signed webhook proves authenticity, not authority. Before honoring a *destructive* event (delete/suspend/teardown), confirm the claimed state against the source-of-truth service, symmetric with how the create path is confirmed. Trusting the payload's claimed subject id on the destructive branch is a single-delivery DoS.
6. **`.catch(() => null)` erases the error/empty distinction** — collapsing "couldn't determine" into the same value as "determined: nothing" silently downgrades a strict check to a loose one on any transient failure. Catch and branch on the error explicitly; for a security check, fail closed.
7. **Distinct failure shapes need distinct signals** — when one guard funnels several causes (provider denial vs. CSRF mismatch vs. missing input) into one error code, UX loses actionability and logs lose incident-response signal. Split the branches even when they all "just redirect to an error page."
8. **Make best-effort failures observable** — an opportunistic side effect (cookie re-mint, cache write) wrapped in a bare `catch {}` can starve silently. At minimum log the skip; better, return a flag a later mutable context can act on.

## What remains

Open themes per the INDEX: Resilient rendering & empty-data UX (Wave 3 — carries the last Critical), LLM provider resilience (Wave 4), Scoring/maturity math (Wave 5), SSE lifecycle & cache staleness (Wave 6), Public-surface input validation (Wave 7), Persistence & DSQL token lifecycle + residual polish (Wave 8).

### Deferred (noted for a later wave)
- **gh-app #1 full form**: per-installation webhook signing and reconciling `installation_repositories` against the live repo set (gh-app #3) remain open — this wave closed the forged-teardown DoS, not the broader webhook-completeness gaps.
- **oauth #2 full form**: a middleware/Route-Handler consumer of the new `needsRefresh` flag (to actually re-mint on the next mutable request) is not yet wired — no `middleware.ts` exists. The flag + log make the starvation observable; the active re-mint is a follow-up.
