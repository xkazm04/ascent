# Fix Wave 6 — Reliability / resilience (ascent, bug-ui-scan-2026-06-20)

> 6 findings closed in 5 atomic commits (1 deferred-with-cause). Baseline preserved: tsc 0;
> tests 2398 → 2412 (+14 regression tests); `next build` green. 0 regressions.
> Branch: `vibeman/bug-ui-scan-2026-06-20-fixes`.

## Commits

| Commit | Finding(s) | Sev | What changed |
|---|---|---|---|
| proxy | github-oauth-session #1 | High | `src/proxy.ts` wraps `supabase.auth.getUser()` in try/catch (like `getViewer`), so a transient Supabase auth blip degrades to "cookie not refreshed" instead of 500-ing every matched request app-wide. |
| github (GHES) | github-repo-data-access #1 | High | `discover.ts` uses `githubApiBase()` instead of a hardcoded `api.github.com`, so org auto-discovery honors the GHES `GITHUB_API_URL` override. |
| llm | llm-provider-abstraction #1 | High | claude-cli availability now keys on `NODE_ENV !== "production"` (matching its `assess()` throw gate), so a non-Vercel prod host correctly reports it unavailable and failover skips it (no silent every-scan mock degrade). |
| webhooks | github-app-installation-webhooks #1, #2 | High×2 | New `listInstallationReposResult()` → `{repos, truncated}`; the webhook reconcile SKIPS the destructive unwatch on a truncated (>50-page) listing (no silent unwatch past page 50). Installation lifecycle work moved to `after()` (verify+dedup still synchronous) so the webhook acks within GitHub's 10s window and a redelivery can't double-process. |
| db | database-client-schema #2 | High | Env-gated `DB_CONNECTION_LIMIT` (+ `DB_POOL_TIMEOUT`) caps the DSQL pool, applied in both `buildDsqlUrl` and the static seed; strict NO-OP when unset (cron never serialized), idempotent across token refresh. |

## Deferred (with cause)

- **database-client-schema #1** (High) — DSQL cold-start serves a possibly-expired token and the ~140
  raw synchronous `getPrisma()` read sites can't reactively self-heal. The only real fix is the broad
  `withDb`/async-accessor migration prior waves deferred (risk of nested-withDb double-retry across
  140 call sites). The seed token is already mitigated as far as a sync accessor allows (`expiresAt:0`
  → every call kicks the single-flight refresh). Needs a deliberate migration session, not a blind sweep.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `vitest run` | 2398 | **2412** (+14: GHES base, claude-cli availability/failover, truncation fail-safe, after() lifecycle, connection-limit) |
| `next build` | green | green |
| Regressions | — | none |

## Patterns added

25. **A best-effort auth read in a hot/app-wide path must be guarded.** An unguarded
    `await getUser()` in the proxy turns a transient auth outage into an app-wide 500. (github-oauth #1)
26. **One config-base helper, every caller.** A single module hardcoding the API host breaks a
    deployment-wide override (GHES) silently. (github-repo-data #1)
27. **An availability gate and its failure gate must use the SAME predicate.** "Available but always
    throws" defeats failover and silently degrades. (llm #1)
28. **A destructive reconcile must run only on a COMPLETE listing.** A silently-truncated source list
    fed to a "remove what's not in the list" reconcile deletes the tail. (webhook #1)
29. **Ack a webhook fast; defer heavy/idempotent work to `after()`.** Synchronous lifecycle work risks
    the provider timeout + redelivery double-processing. (webhook #2)
30. **Make an infra cap env-gated with a no-op default.** A safe knob ships without forcing a
    deployment decision or risking serializing a concurrent job. (db #2)
