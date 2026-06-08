<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Code structure

## Max 300 LOC per `.tsx` file

Keep every React component file (`.tsx`) at **300 lines of code or fewer**. A file approaching the limit is the signal to extract, not to keep appending.

- **Remedy:** pull internal sub-components, their private helpers, and constants into **co-located files** in the same directory (e.g. `report/ScoreWaterfall.tsx`, `report/DimensionCard.tsx`). The original file keeps the orchestrator/page component and imports the extracted pieces. Preserve behavior exactly — extraction is pure relocation, not a redesign. Add `"use client"` to any extracted file that uses hooks or event handlers.
- **Related (`.ts` modules):** a large non-component module (the rule targets `.tsx`, but apply the spirit) is best split into themed sub-modules with the original file kept as a **thin re-export barrel**, so callers and `db/index.ts`-style barrels stay unchanged. See `src/lib/db/org.ts` and `src/lib/db/scans.ts` for the pattern.
- **Check before committing a `.tsx` you grew:**
  ```powershell
  Get-ChildItem -Recurse -Filter *.tsx src | Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
    ForEach-Object { [pscustomobject]@{ LOC=(Get-Content -LiteralPath $_.FullName).Count; Path=$_.FullName } } |
    Where-Object { $_.LOC -gt 300 } | Sort-Object LOC -Descending
  ```
  (Use `-LiteralPath` so App Router `[slug]`/`[owner]` bracket dirs aren't treated as wildcards.)
- **Grandfathered exceedances** (split each when you next substantially edit it; do not let them grow): `components/onboarding/OnboardingFlow.tsx`, `components/org/LiveWarRoom.tsx`, `components/report/RoadmapSandbox.tsx`, `components/report/ReportClient.tsx`, `components/report/Charts.tsx`, `components/launch/FleetMap.tsx`, `components/report/ReportView.tsx`, `components/report/DimensionTrends.tsx`, `components/org/BacklogPanel.tsx`, `components/report/WhatChanged.tsx`, `components/connect/InstallationRepos.tsx`. New `.tsx` files must comply from the start.
