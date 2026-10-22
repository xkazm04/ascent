// The report-export read door (export-0, challenge-2026-10-22d). Route-level behaviour is pinned in
// src/app/api/report/{pdf,llm,share-card}/route*.test.ts; this pins the door's own contract: the
// order (parse, resolve, gate, beforeRead, strict read), the org rule shared with the permalink, and
// the outage-is-503 / empty-is-404 split.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
    }
  },
}));
vi.mock("@/lib/api/respond", () => ({ reportHandledError: vi.fn() }));
vi.mock("@/lib/auth", () => ({ readableOrgForOwner: vi.fn(async () => "public") }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn(async () => null), canReadOrg: vi.fn(async () => false) }));
vi.mock("@/lib/db", () => ({ isDbConfigured: vi.fn(() => true), getScanReportByCommit: vi.fn() }));

import { readReportForExport, exportFilenameStem } from "./export-read";
import { resolveReportOrg } from "./report-org";
import { reportExportHref } from "./export-href";
import { readableOrgForOwner } from "@/lib/auth";
import { canReadOrg, requireOrgRead } from "@/lib/authz";
import { getScanReportByCommit, isDbConfigured } from "@/lib/db";
import { DbUnavailableError } from "@/lib/db/client";

const REPORT = { repo: { owner: "acme", name: "app" } } as never;
const read = (qs: string, beforeRead?: (org: string) => Promise<Response | null>) =>
  readReportForExport(new Request(`http://x.test/api/report/pdf?${qs}`), { label: "report/test", noun: "Test export", beforeRead });
const status = async (r: Awaited<ReturnType<typeof read>>) => (r.ok ? 200 : r.response.status);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(isDbConfigured).mockReturnValue(true);
  vi.mocked(canReadOrg).mockResolvedValue(false);
  vi.mocked(requireOrgRead).mockResolvedValue(null);
  vi.mocked(getScanReportByCommit).mockResolvedValue(REPORT);
});

describe("readReportForExport", () => {
  it("503 with the route's noun when no database is configured, before any gate", async () => {
    vi.mocked(isDbConfigured).mockReturnValue(false);
    const r = await read("repo=acme/app");
    expect(r.ok ? null : await r.response.json()).toEqual({ error: "Test export requires a database." });
    expect(requireOrgRead).not.toHaveBeenCalled();
  });

  it("400 on a missing or malformed ?repo", async () => {
    expect(await status(await read(""))).toBe(400);
    expect(await status(await read("repo=nope"))).toBe(400);
  });

  it("gates, then runs beforeRead, then reads strict under the same org", async () => {
    const order: string[] = [];
    vi.mocked(requireOrgRead).mockImplementation(async (o) => (order.push(`gate:${o}`), null));
    vi.mocked(getScanReportByCommit).mockImplementation(async (_o, _n, opts) => (order.push(`read:${JSON.stringify(opts)}`), REPORT));
    const r = await read("repo=acme/app@deadbeef99", async (o) => (order.push(`before:${o}`), null));
    expect(order).toEqual(["gate:public", "before:public", `read:${JSON.stringify({ headSha: "deadbeef99", orgSlug: "public", strict: true })}`]);
    expect(r.ok && r.stem).toBe("ascent-acme-app-deadbee");
  });

  it("a denial or a beforeRead stop is returned verbatim and nothing is read", async () => {
    const denial = new Response("no", { status: 403 });
    vi.mocked(requireOrgRead).mockResolvedValueOnce(denial as never);
    const denied = await read("repo=acme/app");
    expect(!denied.ok && denied.response).toBe(denial);
    const stop = new Response("pay", { status: 403 });
    const stopped = await read("repo=acme/app", async () => stop);
    expect(!stopped.ok && stopped.response).toBe(stop);
    expect(getScanReportByCommit).not.toHaveBeenCalled();
  });

  it("an outage is 503 'try again', an empty answer is 404 'Scan it first'", async () => {
    vi.mocked(getScanReportByCommit).mockRejectedValueOnce(new DbUnavailableError(new Error("ECONNREFUSED")));
    const outage = await read("repo=acme/app");
    expect(!outage.ok && (await outage.response.json()).error).toMatch(/^Couldn't load this report right now/);
    vi.mocked(getScanReportByCommit).mockResolvedValueOnce(null);
    const empty = await read("repo=acme/app");
    expect(!empty.ok && empty.response.status).toBe(404);
  });
});

describe("resolveReportOrg (shared with the permalink)", () => {
  it("honours a hint only after canReadOrg, normalized; otherwise the owner rule", async () => {
    vi.mocked(canReadOrg).mockImplementation(async (o) => o === "rebrand");
    expect(await resolveReportOrg("acme", " ReBrand ")).toBe("rebrand");
    expect(await resolveReportOrg("acme", "other")).toBe("public");
    expect(await resolveReportOrg("acme", ["rebrand"])).toBe("public");
    expect(await resolveReportOrg("acme", null)).toBe("public");
    expect(readableOrgForOwner).toHaveBeenCalledWith("acme");
  });
});

describe("export filenames and hrefs", () => {
  it("sanitizes a hostile sha in the stem", () => {
    expect(exportFilenameStem({ owner: "acme", name: "app", sha: 'a"b/\r\n' })).not.toMatch(/["/\\r\n]/);
  });

  it("forwards a non-empty org hint and omits a blank one", () => {
    const repo = { owner: "acme", name: "app", headSha: "abc123" };
    expect(reportExportHref("pdf", repo, "rebrand")).toBe("/api/report/pdf?repo=acme%2Fapp%40abc123&org=rebrand");
    expect(reportExportHref("share-card", repo, "  ")).toBe("/api/report/share-card?repo=acme%2Fapp%40abc123");
    expect(reportExportHref("pdf", { owner: "a", name: "b" })).toBe("/api/report/pdf?repo=a%2Fb");
  });
});
