# The App path's limits are GitHub's and the runtime's own

- **Status:** Accepted (2026-10-09, the day the last commit below landed)
- **Date:** 2026-10-09
- **Deciders:** App Master `ascent`, through the security scan run `b0816bbb`. **No source this author
  could read shows an operator ruling on it.** The evidence is the run's result and the code at this head.
  The scan's dependency finding (a `next` upgrade) was left to the operator and is not part of this record.

## Constraint

The security scan of the GitHub App and webhook surface (run `b0816bbb`, result at
`.claude/master/ascent/headless/runs/b0816bbb-bd5a-4ff4-bafc-99000718342b/result.json`) found two
unbounded edges, each a number chosen without reference to the limit it has to live inside:

- **K1: the webhook body was buffered whole before the signature check.** `verifyWebhook` needs the whole
  body, because the HMAC covers it, so the body is read before anything proves who sent it. An
  unauthenticated `POST` could stream an arbitrary body into `request.text()`, which buffered, decoded and
  HMACed all of it on a route under `maxDuration = 300`. The route is excluded from `src/proxy.ts`, so no
  proxy cap applied. The scan rated it medium: on a self-hosted `next start` it exhausts memory and CPU; on
  Vercel the platform's own request cap limits it.
- **K3: the installation-token cache re-minted 180 s before expiry, and a consumer can run 300 s.** A warm
  instance could hand out a token with 181 s left to a webhook `after()` run that lasts up to 300 s. The
  consumers are the PR gate's check-run write, the push-rescan drain (whose `OrgContext` holds one token
  per org for the whole drain) and the registry pass. Nothing on those paths turns a 401 into a re-mint
  (only `listInstallationReposResult` self-heals), so the reads would fail with a 401 and the delivery be
  abandoned. GitHub does not redeliver a delivery already answered 2xx.

## Decision

**A bound on the App path is taken from the platform that imposes it, not from a figure of our own, and
the code that depends on the figure says so where the figure lives.**

1. **A webhook body over GitHub's 25 MB cap is refused with a 413 before the signature check.**
   `WEBHOOK_BODY_MAX_BYTES = 25 * 1024 * 1024` is GitHub's documented payload cap; GitHub delivers nothing
   larger, so nothing over it can be a genuine delivery. `readBoundedText` checks two things, because
   `Content-Length` is the caller's claim: an over-cap declared length is refused before a byte is read,
   and the read counts bytes as they arrive and cancels the stream the moment the total passes the cap. It
   decodes exactly as `request.text()` did (UTF-8, replacement characters, a leading BOM stripped), so
   `verifyWebhook` sees the string it saw before (`src/app/api/app/webhook/body-limit.ts`; called at
   `src/app/api/app/webhook/route.ts:636-638`; `3d581e21`).
2. **A cached installation token is re-minted unless it outlives the longest consumer plus a clock-skew
   budget.** `LONGEST_TOKEN_CONSUMER_MS = 300_000` is the longest one caller holds a single token: every
   route that mints one runs under a `maxDuration` of at most 300 s. The re-mint margin is
   `TOKEN_EXPIRY_SKEW_MS = LONGEST_TOKEN_CONSUMER_MS + CLOCK_SKEW_BUDGET_SEC * 1000`, which is 480 s where
   it was 180 s. The 180 s now covers only host-clock skew against GitHub (`src/lib/github/app.ts:194`,
   `:205`, `:225`; `32a9ebd1`).

**The rule a future change must keep: a consumer that holds an installation token longer than 300 s
raises `LONGEST_TOKEN_CONSUMER_MS` in the same change.** A route that raises its `maxDuration` past 300
raises the constant with it. `src/lib/github/app.test.ts:324-351` reads every `route.ts` under `src/app`,
strips comments and string literals first, and fails if any `maxDuration` exceeds the constant; a seeded
over-limit route proves the matcher still bites (`app.test.ts:336-339`).

## Alternatives that lost

- **Only raise the skew to a bigger number, say 600 s, with no named consumer.** Closes K3 today. It lost
  because a bare figure carries no reason: the next person who tidies it back to 180 s has nothing to
  read, which is how it came to be 180 s. Deriving it from a named constant that a test ties to every
  route's `maxDuration` makes the reason the thing that is checked.
- **Turn a 401 into `invalidateInstallationToken` and a re-mint at each consumer.** The robust fix: it
  also survives an early revocation, not only an expiry. It lost as the fix for K3 because the consumers
  are many (check-run write, scan reads, registry pass) and each holds the token through code that does
  not own the retry; the scan reads it is passed to are the long ones. It is still the right answer for a
  consumer that must outlive 300 s, and nothing here forbids adding it.
- **Mint a fresh token for every consumer and never cache.** No expiry window at all. It lost because
  every mint is an extra round trip to GitHub and a signed App JWT per delivery, and the cache exists
  because mints are rate-limited and slow. The chosen margin costs one extra mint per installation about
  every 52 minutes instead of about 57 (`app.ts`, comment above `TOKEN_EXPIRY_SKEW_MS`).
- **Rely on the platform's body cap, or a proxy limit, for the webhook.** On Vercel the platform caps a
  request at about 4.5 MB (K1's own exploit note), and a proxy cap is one config line. It lost because the
  route is excluded from `src/proxy.ts`, and a self-hosted `next start` has no platform cap at all, which
  is the deployment the open-source mode ships. A bound that holds only on one host is a bound only there.
- **Pick a tighter body cap of our own, say 1 MB.** Cheaper to buffer. It lost because the cap's job is to
  refuse only what GitHub never sends. A figure below GitHub's would reject genuine large pushes, and the
  sender would not retry (GitHub does not redeliver a delivery we answered), so a real push event would be
  silently lost.

## Consequences

- **The route still buffers up to 25 MB per request before it knows the sender.** The bound caps the cost,
  it does not remove it. An unauthenticated sender can still make a self-hosted process hold 25 MB at a
  time, once per concurrent request. Closing that needs a sender check that runs before the body, which
  GitHub's HMAC scheme does not allow.
- **A token costs one more mint on a warm instance, about every 52 minutes per installation** instead of
  about 57.
- **The test guard only sees routes.** It reads `export const maxDuration` in `route.ts` files under
  `src/app`. A consumer that is not a route, such as a long-lived process on a self-hosted install, is not
  checked, and a loop that reuses one token across many deliveries would outlive the margin without any
  test noticing. The rule above is what covers that case, by review.
- **The JWT backdate is a separate number.** The App JWT's `iat` backdate stays at 180 s with
  `exp - iat` held at 600 s (`src/lib/github/app.ts:77-83`); this ADR does not change it, and the two must not be merged
  into one constant.
