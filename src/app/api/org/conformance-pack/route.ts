// GET /api/org/conformance-pack?org=slug[&range=90d|&from=&to=][&sample=25][&file=manifest|sample|findings][&identities=named]
//
// The AI change-management EVIDENCE PACK (W2) — the population, a reproducible sample, and per-item
// control evidence a SOC 2 Type II examiner asks for. See src/lib/conformance/pack.ts for the model
// and the claims discipline that binds every string it emits.
//
// Four responses, one object behind them:
//   file omitted   → JSON (the whole pack — what the UI renders and what an integration consumes)
//   file=manifest  → text/markdown cover note, carrying both CSV hashes
//   file=sample    → text/csv, the drawn sample
//   file=findings  → text/csv, EVERY merged-without-approval row in the full population
//
// AUTH. Reads are org-scoped (`requireOrgRead`) like every other export. `identities=named` is
// additionally OWNER-gated: pseudonymous is the default because a pack is filed with a third party,
// and de-pseudonymizing it names individual engineers against changes that merged unreviewed. That
// is a decision an org owner makes deliberately, not a query param a member can flip.
//
// Every export is AUDITED. An evidence pack leaving the building is exactly the kind of event the
// audit trail exists to record, and the row itself is HMAC-signed like every other.

import { NextResponse } from "next/server";
import { getAiChangePopulation } from "@/lib/db/ai-changes";
import { buildConformancePack } from "@/lib/conformance/pack";
import { packFiles } from "@/lib/conformance/csv";
import { resolveSampleSize } from "@/lib/conformance/sample";
import { sha256Hex } from "@/lib/db/audit-integrity";
import { getOrgId, isDbConfigured, recordAudit } from "@/lib/db";
import { hasOrgRole, requireOrgRead } from "@/lib/authz";
import { resolveOrgWindow } from "@/lib/org/period";
import { safeFilenameSlug } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PackFile = "manifest" | "sample" | "findings";

const FILE_META: Record<PackFile, { contentType: string; ext: string }> = {
  manifest: { contentType: "text/markdown; charset=utf-8", ext: "md" },
  sample: { contentType: "text/csv; charset=utf-8", ext: "csv" },
  findings: { contentType: "text/csv; charset=utf-8", ext: "csv" },
};

function isPackFile(v: string | null): v is PackFile {
  return v === "manifest" || v === "sample" || v === "findings";
}

export async function GET(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "The evidence pack requires a database." }, { status: 503 });
  }
  const url = new URL(request.url);
  const org = url.searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;

  const file = url.searchParams.get("file");
  if (file != null && !isPackFile(file)) {
    return NextResponse.json({ error: "file must be manifest | sample | findings." }, { status: 400 });
  }

  // Named evidence is owner-only. A member asking for it gets a 403 with the reason, not a silent
  // downgrade to pseudonyms — an examiner who thinks they hold named evidence and does not would
  // draw a conclusion the artifact cannot support.
  const wantsNamed = url.searchParams.get("identities") === "named";
  if (wantsNamed && !(await hasOrgRole(org, "owner"))) {
    return NextResponse.json(
      {
        error:
          "Named evidence is owner-only. A pack is filed with a third party and naming individuals against " +
          "unreviewed changes is an owner decision. Re-request without identities=named for the pseudonymous pack.",
      },
      { status: 403 },
    );
  }

  // The SAME period resolution every org tab uses (explicit ?range= › the remembered-period cookie ›
  // the default), so a pack downloaded beside the dashboard covers the window the dashboard shows.
  const period = await resolveOrgWindow(Object.fromEntries(url.searchParams.entries()));
  const population = await getAiChangePopulation(org, { start: period.start, end: period.end });
  if (!population) return NextResponse.json({ error: "Organization not found." }, { status: 404 });

  const pack = buildConformancePack(population, {
    org,
    period: {
      // An open-ended window is stated as such rather than back-filled with a fabricated boundary —
      // the seed is derived from these strings, so they must be honest AND stable.
      from: period.start ? period.start.toISOString().slice(0, 10) : "all-time",
      to: period.end ? period.end.toISOString().slice(0, 10) : "all-time",
      label: period.title,
    },
    sampleSize: resolveSampleSize(url.searchParams.get("sample")),
    identityMode: wantsNamed ? "named" : "pseudonymous",
    generatedAt: new Date().toISOString(),
  });

  // Audit BEFORE responding, and never let an audit failure withhold the artifact (recordAudit's own
  // discipline — it swallows and logs). What matters is that the row records the scope precisely
  // enough to answer "who exported what, naming whom".
  const orgId = await getOrgId(org).catch(() => null);
  await recordAudit(
    "conformance.pack.export",
    {
      period: pack.period,
      populationTotal: pack.population.total,
      findings: pack.population.ungoverned,
      sampleSize: pack.sample.size,
      seed: pack.sample.seed,
      identityMode: pack.provenance.identityMode,
      file: file ?? "json",
    },
    { orgId: orgId ?? undefined },
  );

  if (!file) return NextResponse.json({ pack });

  const files = packFiles(pack);
  const body = files[file];
  const slug = safeFilenameSlug(org);
  const meta = FILE_META[file];
  return new NextResponse(body, {
    headers: {
      "content-type": meta.contentType,
      "content-disposition": `attachment; filename="ascent-evidence-${slug}-${pack.period.from}-${pack.period.to}-${file}.${meta.ext}"`,
      // A filed artifact must never sit in a shared cache: it is org-scoped and may name individuals.
      "cache-control": "private, no-store",
      // Self-verifying: recompute over the bytes to prove the download was not altered. The manifest
      // additionally carries the two CSV hashes in its body, so the three files verify each other.
      "x-ascent-content-sha256": sha256Hex(body),
    },
  });
}
