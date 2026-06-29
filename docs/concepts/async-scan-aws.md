# Concept — Async scan processing on AWS (near-zero cost)

**Status:** concept / backup. Not implemented. Today scans run **synchronously** inside the Vercel
request with Gemini Flash (see below). Adopt this when that stops being true.

## Why this might be needed

A live scan is ~99% LLM time. Measured locally on claude-cli it ran **4.5–11 min** (one repo degraded
to mock at >11 min). Production moved to **Gemini Flash** specifically so a scan fits a single Vercel
function (`maxDuration = 300`), keeping the simple synchronous path. Two things break that bet:

1. **A scan exceeds the request budget.** If a Flash scan trends past ~250s (large repos, slow upstream,
   or reverting to a slower model), Vercel kills the function and the user gets a failure — exactly the
   timeout class we just fixed, returning.
2. **Guaranteed "survive the tab close".** Today persistence + the cache peek make a **refresh** instant,
   and the opt-in completion email fires *if the scan finishes while the request is alive*. A user who
   **closes** the tab mid-scan on Vercel gets neither the report nor the email — there is no post-response
   execution on serverless. Guaranteeing delivery requires running the scan **off** the request.

If neither happens, **don't build this** — the synchronous path is simpler and already correct.

## Adoption trigger

- p90 Flash scan latency approaches ~250s (re-measure with `scripts/scan-timing`), **or**
- a hard product requirement that a queued scan completes + emails even if the browser closes.

## Recommended architecture (fits AWS always-free tiers)

```
 Vercel API (/api/scan/async)        AWS                                   existing app
 ┌───────────────────────┐          ┌──────────────────────────────┐
 │ POST {url, email?}     │  enqueue │  SQS queue (scan-jobs)        │
 │ • auth gate (as today) │ ───────► │                              │
 │ • idempotency key =    │          └──────────────┬───────────────┘
 │   owner/repo@headSha   │                         │ event-source mapping
 │ • return {jobId}       │                         ▼
 └───────────┬───────────┘          ┌──────────────────────────────┐
             │ 202 + poll/SSE        │  Lambda worker (≤15 min)      │
             ▼                       │  • scanRepository()          │ ──► same Postgres/DSQL
 ┌───────────────────────┐          │  • cacheAndPersistScan()     │     (Scan/Repository rows)
 │ /report/owner/repo     │ ◄────────│  • SES sendEmail(permalink)  │ ──► SES → user inbox
 │ peek → persisted report│  poll    │  • mark job done             │
 └───────────────────────┘          └──────────────────────────────┘
```

- **Enqueue (Vercel):** the existing `/api/scan` gate + `resolveScanAuth` stay; instead of running the
  scan, write a job to **SQS** (or a `ScanJob` row / DynamoDB item) keyed by `owner/repo@headSha` and
  return `202 {jobId}`. The client shows the existing ~6-min estimation timer and polls the report
  permalink (the cache peek already returns the persisted report the moment it lands).
- **Worker (Lambda):** SQS event-source-mapping invokes a Lambda that imports the *same* pipeline —
  `scanRepository()` → `classifyScanResult()` → `cacheAndPersistScan()` (`src/lib/scan-finalize.ts`) —
  then `dispatchScanCompletionEmail()` (`src/lib/email`). A 6-min Flash scan is well under Lambda's
  **15-min** hard cap. Persisting to the existing DB means the permalink/cache path needs **zero**
  changes — the report shows up for a polling client and survives a closed tab.
- **Email:** reuse `src/lib/email` (SES) exactly as the synchronous path does — only the call site moves
  into the worker.

### Idempotency & in-flight de-dup

The existing `@@unique([repoId, headSha])` constraint already makes a double-scored commit a no-op
(`persistScanReport` → `deduped: true`). For the queue, set the SQS message **dedup key** (or a
`ScanJob` unique key) to `owner/repo@headSha` so two enqueues of the same commit collapse to one job —
giving the true cross-instance "attach to the in-flight scan" that the synchronous path can only
approximate per-instance via `coalesceScan` (`src/lib/cache.ts`).

### Fallback for unbounded duration

If a scan can exceed Lambda's 15-min cap (e.g. reverting to claude-cli, which hit >11 min), replace the
Lambda worker with **Step Functions → Fargate (Spot)**: no execution-time limit, no idle billing while
waiting, and Spot runs ~60–70% cheaper for a stateless batch task.

## Cost (AWS free tiers, 2026)

At the volume of an early public-scan funnel this is effectively **$0/month** beyond SES postage:

| Service | Free allowance (always-free unless noted) | Notes |
|---|---|---|
| **SQS** | 1,000,000 requests / month | covers enqueue + worker polls comfortably |
| **Lambda** | 1,000,000 requests + 400,000 GB-s / month | a 6-min scan at modest memory is a few GB-s |
| **DynamoDB** (optional job table) | 25 WCU + 25 RCU + 25 GB, always-free | only if not reusing Postgres for job state |
| **SES** | ~$0.10 per 1,000 emails (no permanent free tier) | trivially cheap at low volume |
| **Fargate Spot** (fallback only) | pay-per-second, ~60–70% off on-demand | only when Lambda's 15-min cap is exceeded |

## IAM (least privilege)

- **Vercel role/user:** `sqs:SendMessage` on the one queue only.
- **Lambda execution role:** `sqs:ReceiveMessage`/`DeleteMessage`/`GetQueueAttributes` on the queue,
  `ses:SendEmail` restricted to the verified `SES_FROM_EMAIL` identity, DB network/secret access, and
  the basic Lambda logging policy. No `*` resources.
- Verify the SES sending domain/identity and move out of the SES sandbox before production sends.

## What stays unchanged

`scanRepository`, `cacheAndPersistScan`, `getScanReportByCommit`, `reportPermalink`, and `src/lib/email`
are all reused verbatim — this concept only relocates *where* the scan runs and *who* triggers the
email. The report-retrieval (permalink/cache peek) and the client's estimation timer already behave
correctly against a result that arrives out-of-band.

## Sources (AWS limits & pricing, 2026)

- AWS Lambda 15-min timeout & pricing — <https://aws.amazon.com/lambda/pricing/>
- Lambda vs Fargate for long-running tasks — <https://docs.aws.amazon.com/decision-guides/latest/fargate-or-lambda/fargate-or-lambda.html>
- Amazon SQS pricing (1M requests/mo free) — <https://aws.amazon.com/sqs/pricing/>
- Amazon DynamoDB pricing (always-free 25 WCU/RCU, 25 GB) — <https://aws.amazon.com/dynamodb/pricing/on-demand/>
- Step Functions for long-running / waiting workflows — <https://www.serverless.com/guides/aws-step-functions>
