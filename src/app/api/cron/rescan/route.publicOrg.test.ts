// The cron seeder and the shared "public" org (operator decision 2026-10-07, ask d0eb7d6c): the public
// org has no owner, so a scheduled rescan there has nobody to charge. While the rule binds - the
// auth stack is live, exactly where the import route's public rules bind - the seeder is told to leave
// org "public" out. An auth-off (local, demo, seeding) deployment keeps today's behaviour.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({ isDbConfigured: vi.fn(() => true) }));
vi.mock("@/lib/db/scan-jobs", () => ({
  enqueueDueRescans: vi.fn(async () => 0),
  queueDepth: vi.fn(async () => ({ rescore: { queued: 0, oldestAgeMs: null }, probe: { queued: 0, oldestAgeMs: null } })),
  reapExpiredLeases: vi.fn(async () => 0),
}));
vi.mock("@/lib/db/control-observations", () => ({ sealAllPendingDays: vi.fn(async () => ({ sealed: 0 })) }));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: vi.fn(() => true) }));
vi.mock("@/lib/scan-queue-worker", () => ({
  drainLane: vi.fn(async () => ({ claimed: 0, done: 0, failed: 0, skipped: 0, skippedForCredits: 0, skippedNoToken: 0, truncated: false, errors: [] })),
}));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: vi.fn(() => false) }));
vi.mock("@/lib/access", () => ({ authGateEnabled: vi.fn(() => true) }));

import { GET } from "./route";
import { enqueueDueRescans } from "@/lib/db/scan-jobs";
import { authGateEnabled } from "@/lib/access";
import { isAuthConfigured } from "@/lib/auth";

const seed = vi.mocked(enqueueDueRescans);
const call = () => GET(new Request("http://localhost/api/cron/rescan", { headers: { authorization: "Bearer s3cret" } }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s3cret";
  vi.mocked(authGateEnabled).mockReturnValue(true);
  vi.mocked(isAuthConfigured).mockReturnValue(false);
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("cron/rescan seed and the shared public org", () => {
  it("excludes org 'public' from the seed while the auth stack is live", async () => {
    await call();
    expect(seed).toHaveBeenCalledWith(undefined, { excludeOrgSlugs: ["public"] });
  });

  it("excludes it under the dormant custom-OAuth stack too (isAuthConfigured)", async () => {
    vi.mocked(authGateEnabled).mockReturnValue(false);
    vi.mocked(isAuthConfigured).mockReturnValue(true);
    await call();
    expect(seed).toHaveBeenCalledWith(undefined, { excludeOrgSlugs: ["public"] });
  });

  it("excludes nothing on an auth-off deployment (local, demo, seeding)", async () => {
    vi.mocked(authGateEnabled).mockReturnValue(false);
    await call();
    expect(seed).toHaveBeenCalledWith(undefined, { excludeOrgSlugs: [] });
  });
});
