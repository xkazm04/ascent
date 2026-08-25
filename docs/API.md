# HTTP API: the curl tour

Every scan the UI runs is a plain HTTP call you can make yourself. These examples assume a local
`npm run dev` on `:3000`; with nothing configured they run in deterministic mock mode.

## Scanning, gating, badges (no database needed)

```bash
# Blocking scan (POST or GET ?url=)
curl -s localhost:3000/api/scan -H 'content-type: application/json' \
  -d '{"url":"vercel/next.js"}' | jq '{level, overallScore, posture}'

# Streaming scan (Server-Sent Events: progress + result)
curl -N localhost:3000/api/scan/stream -H 'content-type: application/json' \
  -d '{"url":"facebook/react"}'

# Maturity gate — 200 on pass, 422 on fail (curl --fail / CI branches on status)
curl -s -o /dev/null -w '%{http_code}\n' \
  'localhost:3000/api/gate/vercel/next.js?min_level=L3&no_ungoverned=1'

# SVG badge (level or ?gate=1 pass/fail)
curl -s 'localhost:3000/api/badge/facebook/react?style=flat'
```

## Persistence endpoints (with `DATABASE_URL` set)

```bash
curl -s 'localhost:3000/api/history?repo=facebook/react'        | jq '.scans[] | {scannedAt,level,overallScore}'
curl -s 'localhost:3000/api/recommendations?repo=facebook/react'| jq '.items[] | {title,status}'
curl -s -X PATCH 'localhost:3000/api/recommendations/<id>' -H 'content-type: application/json' -d '{"status":"done"}'
curl -s 'localhost:3000/api/usage?org=acme&days=30&format=csv'
```

## Where the contracts live

- Request/response shapes, the pre-scan gate order and the SSE protocol:
  [`features/scanning/scan.md`](./features/scanning/scan.md).
- Gate policy semantics and the published GitHub Action wrapper:
  [`features/scanning/gate.md`](./features/scanning/gate.md), [`action.yml`](../action.yml).
- Badge styles and caching: [`features/billing/badge.md`](./features/billing/badge.md).
- The MCP door for coding agents (`POST /api/mcp`, read-only, bearer org tokens):
  [`features/org-knowledge/skills.md`](./features/org-knowledge/skills.md#the-agent-door--mcp-server-w5-2026-08-14).
