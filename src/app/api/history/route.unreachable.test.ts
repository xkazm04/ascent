import { describe, it, expect, vi, beforeEach } from "vitest";

// The client-fallback routes ReportView lands on when the permalink leaves a prop unresolved must answer a
// configured-but-UNREACHABLE database as a FAILURE (500), never as the false fact the default degrading
// reader produced. 503 stays the no-database answer (ReportView treats it as a quiet mode).

const h = vi.hoisted(() => ({ configured: true, prisma: null as unknown }));

vi.mock("@/lib/api/respond", () => ({ reportHandledError: vi.fn() }));
vi.mock("@/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/client")>()),
  isDbConfigured: () => h.configured,
  getPrisma: () => h.prisma,
}));

// The REAL readers over the REAL client wrappers; only Prisma is faked.
vi.mock("@/lib/db", async () => {
  const read = await vi.importActual<typeof import("@/lib/db/scans-read")>("@/lib/db/scans-read");
  return { getRepositoryHistory: read.getRepositoryHistory, isDbConfigured: () => h.configured };
});
vi.mock("@/lib/auth", () => ({ isAuthConfigured: () => false, readableOrgForOwner: async () => "acme" }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, resolveViewerLogin: async () => "dev" }));
vi.mock("@/lib/authz", () => ({ canReadOrg: async () => false }));

import { reportHandledError } from "@/lib/api/respond";
import { GET } from "./route";

const unreachable = () =>
  Object.assign(new Error("Can't reach database server at `db.internal:5432`"), { name: "PrismaClientInitializationError" });
/** A Prisma client whose every `model.method()` throws (or resolves `null` when `fail` is false). */
function prisma(fail: boolean) {
  const method = async () => {
    if (fail) throw unreachable();
    return null;
  };
  return new Proxy({}, { get: () => new Proxy({}, { get: () => method }) });
}

beforeEach(() => {
  h.configured = true;
  h.prisma = null;
  vi.mocked(reportHandledError).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const req = (qs = "") => new Request("http://t/api/history?repo=acme/web" + qs);

describe("GET /api/history on an unreachable DB", () => {
  it("(a) real reader, Prisma unreachable → 500 + door, not 200 with empty scans", async () => {
    h.prisma = prisma(true);
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(res.status).not.toBe(503);
    expect(console.error).toHaveBeenCalled();
    const [err] = vi.mocked(reportHandledError).mock.calls[0]!;
    expect((err as Error).name).toBe("DbUnavailableError");
  });

  it("(a) the CSV export fails the same way", async () => {
    h.prisma = prisma(true);
    expect((await GET(req("&format=csv"))).status).toBe(500);
  });

  it("(b) reachable DB, no rows → still 200 with empty scans", async () => {
    h.prisma = prisma(false);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).scans).toEqual([]);
    expect(reportHandledError).not.toHaveBeenCalled();
  });

  it("(c) DB not configured → still 503", async () => {
    h.configured = false;
    expect((await GET(req())).status).toBe(503);
  });
});
