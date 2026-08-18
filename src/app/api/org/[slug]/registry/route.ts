// GET  /api/org/:slug/registry -> 200 { view: RegistryView } (always the REAL view; the shaped
//                                 example states are a client-side preview, never a URL)
// POST /api/org/:slug/registry -> map an existing repo, or create <org>/ai-registry, then open the
//                                 scaffold PR.
//
// POST body: { fullName?: "owner/repo", create?: boolean, name?: string, canonical?: boolean,
//              mode?: "git_native"|"hosted_mirror", telemetrySink?: "api"|"registry"|"off" }
//   `create: true` creates `<slug>/<name ?? "ai-registry">` (organization accounts only) and then
//   scaffolds it; otherwise `fullName` must name a repo the App can already see.
//
// Every failure is `{ error, code }` with a real status — never a bare 500 — so the tab can say what
// went wrong. The mapping row is persisted BEFORE the PR attempt, so a GitHub failure leaves a
// resumable `error` row rather than nothing at all.

import { NextResponse } from "next/server";
import { resolveViewerLogin } from "@/lib/access";
import { getRegistryView } from "@/lib/org/registry-view";
import {
  REGISTRY_MODES,
  TELEMETRY_SINKS,
  upsertOrgRegistry,
  type RegistryModeValue,
  type TelemetrySinkValue,
} from "@/lib/db/org-registry";
import { setRegistryStatus } from "@/lib/db/org-registry-write";
import { githubErrorResponse, guardRegistryRead, guardRegistryWrite, registryError } from "@/lib/registry/api";
import { DEFAULT_REGISTRY_NAME, parseFullName } from "@/lib/registry/layout";
import { createRegistryRepo, openScaffoldPr } from "@/lib/registry/scaffold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

const pick = <T extends string>(allowed: readonly string[], raw: unknown): T | undefined =>
  typeof raw === "string" && allowed.includes(raw) ? (raw as T) : undefined;

export async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const denied = await guardRegistryRead(slug);
  if (denied) return denied;
  return NextResponse.json({ view: await getRegistryView(slug) });
}

export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const gate = await guardRegistryWrite(slug);
  if (gate instanceof NextResponse) return gate;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const mode = pick<RegistryModeValue>(REGISTRY_MODES, body.mode);
  const telemetrySink = pick<TelemetrySinkValue>(TELEMETRY_SINKS, body.telemetrySink);
  const canonical = body.canonical === undefined ? true : body.canonical === true;

  // ── resolve the target repo ─────────────────────────────────────────────────────────────────
  let fullName: string;
  let defaultBranch: string | undefined;
  if (body.create === true) {
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : DEFAULT_REGISTRY_NAME;
    if (!REPO_NAME_RE.test(name)) return registryError("invalid-input", "That repository name is not valid.", 400);
    try {
      // GitHub itself is the authority on whether this installation may create a repo; a `denied`
      // result IS the permission check (the tab's `canCreateRepo` flag only decides what to render).
      const created = await createRegistryRepo(gate.token, slug, name);
      if (created.kind === "denied") return registryError("not-permitted", created.message, 403);
      fullName = created.fullName;
      defaultBranch = created.defaultBranch;
    } catch (err) {
      return githubErrorResponse(err);
    }
  } else {
    const ref = parseFullName(typeof body.fullName === "string" ? body.fullName : "");
    if (!ref) return registryError("invalid-input", 'Provide `fullName` as "owner/repo", or set `create: true`.', 400);
    fullName = `${ref.owner}/${ref.repo}`;
  }

  const row = await upsertOrgRegistry(slug, {
    fullName,
    defaultBranch,
    canonical,
    mode,
    telemetrySink,
    status: "scaffolding",
    createdBy: await resolveViewerLogin().catch(() => null),
  });
  if (!row) return registryError("persistence-off", "The registry could not be saved.", 503);

  // ── scaffold ────────────────────────────────────────────────────────────────────────────────
  try {
    const scaffold = await openScaffoldPr({ token: gate.token, slug, fullName, base: defaultBranch });
    if (scaffold.kind === "bad-repo") return registryError("invalid-input", scaffold.message, 400);
    if (scaffold.kind === "already-installed") {
      // The repo IS a registry already: mapping it was the whole action. It stays `scaffolding`
      // (mapped, not yet read) until POST …/registry/index runs.
      return NextResponse.json({ fullName, status: "scaffolding", scaffolded: false, message: scaffold.message });
    }
    await setRegistryStatus(row.id, "scaffold_pr_open", { scaffoldPrUrl: scaffold.url, lastError: null });
    return NextResponse.json({
      fullName,
      status: "scaffold_pr_open",
      scaffolded: true,
      scaffoldPrUrl: scaffold.url,
      prNumber: scaffold.number,
      branch: scaffold.branch,
      committed: scaffold.committed,
      skipped: scaffold.skipped,
      reused: scaffold.reused,
    });
  } catch (err) {
    await setRegistryStatus(row.id, "error", { lastError: err instanceof Error ? err.message : String(err) }).catch(
      () => {},
    );
    return githubErrorResponse(err);
  }
}
