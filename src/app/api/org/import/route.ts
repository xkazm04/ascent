// POST /api/org/import  { org, count?, repos?, mock?, watch?, schedule? }  — Server-Sent Events.
//
// Token-based bulk scan of a PUBLIC org's (or user's) repositories — no GitHub App required.
// Lists the org's most-recently-pushed public repos (or uses an explicit `repos` list),
// scans each, persists under the `org` slug, and optionally marks them watched + scheduled.
//
// This powers two things:
//   1. The free-tier funnel: "scan a whole public org" without installing the App.
//   2. Local demo/seeding (see scripts/seed-org.mjs and docs/ENTERPRISE.md §5).
//
// Needs DATABASE_URL. A GITHUB_TOKEN (env) is strongly recommended to avoid rate limits.

import { NextResponse } from "next/server";
import { scanRepository } from "@/lib/scan";
import { isDbConfigured, persistScanReport, setRepoSchedule, setRepoWatch } from "@/lib/db";
import { listOrgRepos } from "@/lib/github/list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // bulk runs are long

const SCHEDULES = new Set(["off", "daily", "weekly", "monthly"]);

export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Org import requires a database (DATABASE_URL)." }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    count?: number;
    repos?: string[];
    mock?: boolean;
    watch?: boolean;
    schedule?: string;
  };
  const org = body.org?.trim().toLowerCase();
  if (!org) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });

  const count = Math.min(100, Math.max(1, body.count ?? 20));
  const mock = body.mock ?? true;
  const watch = body.watch ?? true;
  const schedule = body.schedule && SCHEDULES.has(body.schedule) ? body.schedule : "weekly";
  const token = process.env.GITHUB_TOKEN || undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };
      try {
        // 1. Resolve the repo list.
        let fullNames: { owner: string; name: string; fullName: string; url: string }[];
        if (body.repos?.length) {
          fullNames = body.repos.map((fn) => {
            const [owner, name] = fn.includes("/") ? fn.split("/") : [org, fn];
            return { owner, name, fullName: `${owner}/${name}`, url: `https://github.com/${owner}/${name}` };
          });
        } else {
          send("progress", { stage: "list", message: `Listing public repos for ${org}…` });
          const repos = await listOrgRepos(org, count, token);
          fullNames = repos.map((r) => ({ owner: r.owner, name: r.name, fullName: r.fullName, url: r.url }));
        }

        if (fullNames.length === 0) {
          send("error", { error: `No public repositories found for "${org}".` });
          return;
        }
        send("progress", { stage: "found", total: fullNames.length, mock, watch, schedule });

        // 2. Scan + persist each.
        let scanned = 0;
        for (const r of fullNames) {
          send("progress", { stage: "scan", repo: r.fullName, index: scanned, total: fullNames.length });
          try {
            const report = await scanRepository(r.fullName, { token, mock });
            const persisted = await persistScanReport(report, { orgSlug: org });
            if (persisted && (persisted.failures.audit || persisted.failures.contributors > 0)) {
              console.warn("[org/import] persisted with partial write failures", {
                repo: r.fullName,
                scanId: persisted.scanId,
                failures: persisted.failures,
              });
            }
            if (watch) await setRepoWatch(org, r, true);
            if (watch && schedule !== "off") await setRepoSchedule(org, r.fullName, schedule);
            send("repo", {
              repo: r.fullName,
              level: report.level.id,
              overall: report.overallScore,
              posture: report.posture.id,
              adoption: report.adoptionScore,
              rigor: report.rigorScore,
              contributors: report.contributors?.length ?? 0,
            });
          } catch (err) {
            send("repo", { repo: r.fullName, error: err instanceof Error ? err.message : "scan failed" });
          }
          scanned += 1;
          send("progress", { stage: "scan", repo: r.fullName, index: scanned, total: fullNames.length });
        }
        send("result", { org, scanned, total: fullNames.length, dashboard: `/org/${org}` });
      } catch (err) {
        send("error", { error: err instanceof Error ? err.message : "Org import failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
