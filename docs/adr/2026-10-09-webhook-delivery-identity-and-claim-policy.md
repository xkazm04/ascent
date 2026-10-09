# A webhook delivery is identified by its id and its signed body, and the route owns the claim-failure policy

- **Status:** Proposed (2026-10-09). **No code implements this yet.** The Decision is a proposal for the
  operator to accept, amend or reject; nothing below is a ruling.
- **Date:** 2026-10-09
- **Deciders:** none yet. Raised by App Master `ascent` from architecture review `2572d2b3` (its findings 4
  and 7, ADR candidates 1 and 2) and security scan `b0816bbb` (finding C1). Their result files were not
  re-read for this record; the code at this head is the evidence.
- **Binds to:** [2026-10-09-app-path-bounds-follow-platform-limits](2026-10-09-app-path-bounds-follow-platform-limits.md)
  (the body is read bounded, then HMACed, before anything here runs) and
  [2026-10-09-caught-write-failure-is-not-a-different-answer](2026-10-09-caught-write-failure-is-not-a-different-answer.md)
  (a caught failure is never a different answer and never silent). Neither is edited or contradicted.

## Constraint

Two linked questions, one record, because the second only has an answer once the first is fixed.

**(a) What identifies a delivery for replay defense.** GitHub's HMAC covers the body only
(`src/lib/github/app.ts:406-412`: `createHmac("sha256", secret).update(rawBody)`). The `X-GitHub-Delivery`
header is not under the signature, yet it is the only key the replay defense uses:

- The route reads it at `src/app/api/app/webhook/route.ts:664`, and claims only `if (delivery)`
  (`:665`). **A request with a valid signature and no delivery header skips the whole defense**: no
  in-memory check, no DB claim, and the event is processed (`:685-827`).
- A captured signed body re-sent under a **fresh, attacker-chosen delivery id** is a new delivery to both
  levels: the in-memory Map is keyed by id (`src/lib/github/webhook-delivery.ts:85`, `:93-97`) and so is
  the table (`prisma/schema.prisma:1533-1534`, `id String @id // GitHub X-GitHub-Delivery id`;
  `src/lib/db/webhook-deliveries.ts:32-37`). The route's own comment says the HMAC "never expires"
  (`route.ts:127-134`); the defense it built against that is a key the replayer controls.
- Some lanes add a second guard of their own, which is why the exposure differs by lane. A push rescan's
  idempotency bucket is the delivery id, or an aligned time window when the throttle is on
  (`src/lib/push-rescan.ts:35-38`), so a fresh id only escapes the window; a control probe's bucket is the
  delivery id itself (`src/lib/db/scan-jobs.ts:208-222`), so a fresh id enqueues a new free probe. The PR
  gate has no bucket: `runPrGate` carries "no webhook state" (`route.ts:227-229`).

**(b) Who owns the failure policy of the claim, and which way it fails.** `claimWebhookDelivery` fails
**open** in two places: with no database (`webhook-deliveries.ts:23`) and on any error
(`:44-47`, "allowing (fail-open)"). It therefore never throws. The route wraps the call in a `try` whose
`catch` rolls back the in-memory record and answers `500 "Delivery claim failed."`
(`route.ts:668-679`) so that GitHub retries. **That branch is dead**: nothing in the claim can reach it,
and the file's header documents the fail-open as intended (`webhook-deliveries.ts:8`, `:18-20`). Two
modules therefore hold opposite policies for one event, and the one the route's author wrote down does not
run. The earlier ADR's rule applies directly: a caught failure at a write door must not be "a different
answer" (here, "this is a fresh delivery") and must not be silent; the claim logs with `console.warn` and
does not report (`reportHandledError`, `src/lib/api/respond.ts:62`).

What the lanes do once past the claim differs a great deal, and the policy has to follow it
(`route.ts` line numbers):

| Lane | Line | What it does | Spends money / posts to GitHub? |
| --- | --- | --- | --- |
| `push` on the default branch | `:768-786` | queues a `webhook:push` rescan job and drains it (`runPushRescan`, `:517-538`); a registry pass | **Money**: the job is charged unless the org is BYOM ([byom ADR](2026-10-09-byom-push-rescan-is-not-metered.md)) |
| `pull_request` (`PR_ACTIONS`) and `check_run` re-run | `:717-730`, `:749-767` | `runPrGate`: a scan (`mock: true`, `src/lib/github/pr-gate.ts:100`, `:103`) then `createCheckRun` and `upsertStickyComment` (`:23`, `:182`, `:207`) | **GitHub writes**: a check run and a sticky comment; no credit seen in `pr-gate.ts` |
| `installation`, `installation_repositories` | `:686-716` | installation upsert/removal; unwatch and auto-watch reconcile (`:250`) | DB writes, destructive but GitHub-confirmed; no spend |
| `pull_request_review`, `pull_request` closed | `:735-748` | `reduceAiChangeEvent`: records an attribution row | no |
| Repo control events (`REPO_CONTROL_EVENTS`) and `member`/`team` | `:787-826` | `enqueueControlProbe`: a **free** probe that re-reads GitHub; `recordControlAttribution` | no (`:789`, `:813-815`) |

Whether a DB-dependent lane could have proceeded during a claim-store failure, read from the code:

- **push, control events, org control events** are gated on `isDbConfigured()` (`:768`, `:787`, `:812`)
  and all end in an enqueue (`enqueueAndDrainPushRescan`, `enqueueProbeJob`). If the database is down, the
  enqueue also fails, and these lanes already release the delivery (`:524-538`, `:324`, `:498`). The same
  outage that failed the claim stops them.
- **The PR gate is not gated on `isDbConfigured()`** (`:717`, `:749`). Its owner check
  (`installationMatchesOwner`, `:143-186`) fails closed when `getInstallationIdForOwner` throws
  (`:148-157`), so a DB outage aborts the gate and releases the delivery. But with **no database
  configured** that lookup returns `null` (`src/lib/db/installations.ts:245`), the check falls through to
  GitHub confirmation, and the gate runs. So "the claim store is unavailable" has two causes with
  different answers: *not configured* (a legitimate DB-less App deployment, where the claim cannot exist)
  and *configured but erroring*.
- **The claim can fail while the rest of the database works.** The `WebhookDelivery` table is raw SQL
  (`webhook-deliveries.ts:7`), outside the generated client. A missing table or a failed migration fails
  the claim alone. Then push, control and gate lanes would proceed with no replay defense, and the
  fail-open would be silent. This is the case the "DB is down anyway" argument does not cover.

The release side is the other half of the contract and is not in question: a claim means "successfully
processed". A deferred failure releases it (`forgetDelivery`, `webhook-delivery.ts:128-131`;
`abandonDelivery`, `:141-144`; the route's own catch, `route.ts:833`), the push lane deliberately does not
once a job row exists (`route.ts:777`, `push-rescan.ts:66-69`), and the claim lasts a day
(`REPLAY_HORIZON_MS`, `route.ts:135`) where the library default is ten minutes
(`webhook-deliveries.ts:13`).

**GitHub's redelivery semantics are not established by a source in this repo.** The repo's comments assume
that GitHub redelivers on a non-2xx and that a redelivery keeps the delivery id (`checks.ts:12`,
`pr-gate.ts:79-82`, `route.ts:128`, `:651`; the app-path ADR says "GitHub does not redeliver a delivery
already answered 2xx"). None cites GitHub's documentation. Treat as **assumptions the implementation must
verify against GitHub's docs and a real redelivery before it ships**:

1. a redelivery (automatic or manual) reuses the original `X-GitHub-Delivery` id **and** the same body;
2. two legitimate, distinct deliveries never share a signed body (so a body hash is a safe second key, and
   a body hash alone is not a legitimate-collision hazard);
3. every real delivery carries the header.

If (2) is false (identical `ping` bodies, say), a body-hash key refuses a genuine event. If (3) is false,
refusing a missing header drops genuine events.

## Decision

**Proposed, for the operator to accept or amend.** The recommendation is kept as given; the code did not
show it wrong, but it changed two details, marked below.

1. **A delivery with no `X-GitHub-Delivery` header is refused** (a 400, before any lane runs). Today it
   skips the defense (`route.ts:665`).
2. **A delivery is claimed on two keys: its delivery id and a hash of the signed raw body.** Both must be
   fresh for the delivery to proceed. A captured body re-sent under a new id is refused on the body key; a
   known id with a different body is refused on the id key. The body hash is computed over the same `raw`
   string that `verifyWebhook` just verified (`route.ts:636-641`), so it keys on exactly the bytes the
   signature covers. The `WebhookDelivery` table stays one table; the body key is a second row, or a second
   column with its own unique index, an implementation choice the schema owner makes.
3. **The claim store reports a failure instead of deciding it, and the route owns the policy per lane.**
   `claimWebhookDelivery` returns a three-way result (claimed, duplicate, failed) and does not swallow
   an error; "no database configured" is a fourth, distinct, non-failure state.
   - A lane that **spends money or posts to GitHub fails closed on a claim failure**: a reported 5xx
     (`reportHandledError`), so a retry is possible, with the in-memory record rolled back
     (`forgetLocalDelivery`, as the dead branch at `route.ts:676-678` already intends). That is the `push`
     lane and the PR-gate lanes (`pull_request`, `check_run`).
   - A lane that **only triggers a re-read fails open**, logged and reported: control events,
     `member`/`team`, `installation_repositories` (whose reconcile is GitHub-confirmed). A replay there
     costs one free probe or one idempotent reconcile, and dropping a genuine event on a blip is the worse
     outcome.
   - **Changed detail 1: "no database configured" is not a failure.** The PR gate runs with no database
     (above), so failing it closed on the missing store would break a DB-less App deployment. It keeps the
     in-memory fast path only, as today.
   - **Changed detail 2: the lane is known before the claim, so the route classifies the event first.**
     Today the claim runs before the event dispatch (`route.ts:664` before `:685`). The policy needs the
     event name (`:645`, already read) to pick the lane; no dispatch is moved.
   - `installation` lifecycle stays fail-open: it is DB-writing but GitHub-confirmed
     (`confirmRevocationWithGitHub`, `route.ts:201`, `:707-708`), and a fail-closed 5xx there would let a
     claim blip stall an uninstall.

## Alternatives that lost

- **Leave it as it is: HMAC authenticates, the delivery id dedupes, a missing header is tolerated.** The
  cheapest, and it matches what GitHub sends in practice. It lost because the defense is keyed on an
  attribute the replayer controls: the claim exists to stop a captured signed delivery from re-running,
  and a fresh id (or no header) re-runs it. The 24-hour horizon (`route.ts:135`) makes the stored claim
  long and the key it holds weak.
- **Key on the body hash alone, and ignore the delivery id.** Strictly stronger against replay, since the
  signed bytes are what the HMAC vouches for. It lost because GitHub's redelivery semantics are unverified
  here (assumption 2): if two genuine deliveries can share a body, it drops real events, and a lost event
  is silent. Keeping the id as a second key bounds that risk to a refusal that needs both to be reused.
  It would also stop identifying a delivery in logs and in the idempotency buckets already keyed on it
  (`scan-jobs.ts:208-222`, `push-rescan.ts:37`).
- **Fail closed on every lane, as the dead branch intended (`route.ts:670-679`).** One rule, nothing to
  classify. It lost because control events cost nothing to replay and the hourly cadence catches a missed
  one, so a 500 storm during a database blip buys no safety there and makes GitHub's delivery log show
  failures for harmless work. It also fails the DB-less deployment unless "not configured" is carved out,
  which is changed detail 1.
- **Fail open everywhere, and delete the route's dead catch.** It makes the two modules agree with the
  least code, and the claim file already argues for it ("failing closed would drop legitimate deliveries
  during a DB blip", `webhook-deliveries.ts:19-20`). It lost because the blip argument assumes the whole
  database is down, in which case the push and control lanes fail on their own enqueue. The case that
  matters is the claim table alone failing while the database is up, and there the push rescan would spend
  money and the gate would post to GitHub with no replay defense and one `console.warn` as the only
  trace. That is "a different answer, silently" in the earlier ADR's terms.
- **Make the claim store own the policy through a flag** (`claimWebhookDelivery(id, ttl, { failClosed })`).
  Keeps the route short. It lost because the store cannot know the lane's stake; the route can, and a
  boolean parameter hides the decision at a call site where the next reader sees a bare `true`. A
  returned failure forces every caller to say what it does with one, which is the property
  `dbReadStrict` gives reads.
- **Verify a delivery by asking GitHub for it** (the App's deliveries API) instead of trusting headers.
  Authoritative on identity. It lost because it adds a GitHub round trip, and a rate-limited, App-JWT
  authenticated call, to every event on a route that must ack in about ten seconds (`route.ts:560`),
  and the same outage that fails the claim would fail the check.

## Consequences

- **The implementation, not done here**, would change:
  - `src/lib/db/webhook-deliveries.ts`: a result type, no swallow, a body-hash key, and a test file beside
    it (none exists at this head).
  - `src/lib/github/webhook-delivery.ts` and its callers: the in-memory Map keys on both values;
    `forgetLocalDelivery`, `forgetDelivery` and `abandonDelivery` release both.
  - `src/app/api/app/webhook/route.ts`: a 400 for a missing header, the lane classification, and the
    per-lane policy at `:664-683`. This file is 837 lines; the AGENTS.md 300-line rule is for `.tsx`, but
    the spirit applies, so the classification belongs in its own module.
  - `prisma/schema.prisma` and a migration for the body key, which touches the data model doc.
  - `src/app/api/app/webhook/route.test.ts`: replace the mock that always resolves `true`
    (`route.test.ts:34`) with cases for each result, per lane, plus a missing header, a fresh id with a
    reused body, and a seeded-violation test in the style of the existing guards.
  - `docs/features/github/github-app.md` under the doc-sync rule, because a missing header becomes a 400.
- **A genuine delivery with no header, or one whose body repeats, would be refused** if assumptions 1 to 3
  are false. The implementation's first step is to check them against GitHub's documentation and a live
  redelivery; if they fail, this record is superseded, not edited.
- **A claim-store failure becomes visible.** A reported 5xx on the money and GitHub-write lanes means a
  claim-table outage shows in the reporter and in GitHub's delivery log, which is the point and also the
  volume. The control lanes log and report but still process.
- **A captured body can no longer be replayed under a fresh id**, except by an attacker who also holds the
  webhook secret, which this ADR does not address.
- **The 24-hour claim and the ten-minute in-memory entry stay as they are.** A replay after the claim
  expires is processed again; this record narrows the key, not the horizon.
- **Still open, deliberately:** the in-memory Map is process-local and its backlog note stands
  (`webhook-delivery.ts:76-79`); `claimWebhookDelivery`'s opportunistic sweep (`:40-42`) is untouched.
