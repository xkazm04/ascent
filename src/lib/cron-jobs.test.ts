// The one cron-job table: parity with vercel.json and the route directories, and the three-state
// readiness every consumer (health, the routes) derives from it.

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({ isDbConfigured: vi.fn(() => true) }));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: vi.fn(() => true) }));

import { CRON_JOBS, cronReadiness, cronTableDrift, type CronJobName } from "./cron-jobs";

const ROOT = process.cwd();
const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
  crons: { path: string; schedule: string }[];
};
const cronDir = join(ROOT, "src/app/api/cron");
const routeDirs = readdirSync(cronDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(cronDir, d.name, "route.ts")))
  .map((d) => d.name);
const ALL: CronJobName[] = ["rescan", "probe", "digest", "purge", "athena"];

describe("CRON_JOBS parity", () => {
  it("equals vercel.json crons exactly ({path, schedule}) and covers every cron route directory", () => {
    const table = CRON_JOBS.map((j) => ({ path: j.path, schedule: j.schedule })).sort((a, b) => a.path.localeCompare(b.path));
    const scheduled = [...vercel.crons].sort((a, b) => a.path.localeCompare(b.path));
    expect(table).toEqual(scheduled);
    expect(routeDirs.length).toBeGreaterThanOrEqual(5);
    expect(cronTableDrift(CRON_JOBS, vercel.crons, routeDirs)).toEqual([]);
  });

  it("a seeded mismatch (table minus one job) is reported by that job's name", () => {
    const seeded = CRON_JOBS.filter((j) => j.name !== "digest");
    const drift = cronTableDrift(seeded, vercel.crons, routeDirs);
    expect(drift.length).toBeGreaterThan(0);
    expect(drift.every((d) => d.startsWith("digest:"))).toBe(true);
  });

  it("a seeded schedule change and an unrouted directory are both named", () => {
    const moved = CRON_JOBS.map((j) => (j.name === "probe" ? { ...j, schedule: "*/5 * * * *" } : j));
    expect(cronTableDrift(moved, vercel.crons, routeDirs).some((d) => d.startsWith("probe:"))).toBe(true);
    expect(cronTableDrift(CRON_JOBS, vercel.crons, [...routeDirs, "ghost"])).toEqual([
      "ghost: src/app/api/cron/ghost/route.ts has no CRON_JOBS row",
    ]);
  });
});

describe("cronReadiness", () => {
  it("db missing -> every job blocked on ['db'] with a remedy naming DATABASE_URL", () => {
    const r = cronReadiness({ db: false, githubApp: true, cronSecret: true });
    for (const name of ALL) {
      expect(r[name].state).toBe("blocked");
      expect(r[name].missing).toEqual(["db"]);
      expect(r[name].remedy).toContain("DATABASE_URL");
    }
  });

  it("everything configured -> every job ready", () => {
    const r = cronReadiness({ db: true, githubApp: true, cronSecret: true });
    for (const name of ALL) expect(r[name]).toEqual({ state: "ready", missing: [], remedy: "" });
  });

  it("CRON_SECRET unset -> every job blocked with cronSecret missing, never ready", () => {
    for (const probe of [
      { db: true, githubApp: true, cronSecret: false },
      { db: true, githubApp: false, cronSecret: false },
    ]) {
      const r = cronReadiness(probe);
      for (const name of ALL) {
        expect(r[name].state).toBe("blocked");
        expect(r[name].missing).toContain("cronSecret");
        expect(r[name].remedy).toContain("CRON_SECRET");
      }
    }
  });

  it("rescan without the GitHub App is degraded (a partial run), not blocked", () => {
    const r = cronReadiness({ db: true, githubApp: false, cronSecret: true });
    expect(r.rescan).toMatchObject({ state: "degraded", missing: ["githubApp"], runs: ["ledgerSeal"], skips: ["reap", "seed", "drain"] });
    expect(r.rescan.remedy).toContain("GITHUB_APP_ID");
    expect(r.purge.state).toBe("ready");
  });

  it("remedies carry env var names only and no em dash", () => {
    const r = cronReadiness({ db: false, githubApp: false, cronSecret: false });
    for (const name of ALL) expect(r[name].remedy).not.toContain("\u2014");
  });
});
