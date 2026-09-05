// Trigger the in-server fleet seeder against a running dev server (or a deployed instance).
//
// The actual generation + persistence runs inside the server process (POST /api/dev/seed-fleet) so it
// reaches the in-process PGlite DB in local dev — a standalone Node script can't. This script is just a
// long-timeout HTTP trigger.
//
// Usage:
//   node scripts/seed-fleet.mjs [org] [repoCount] [scansPerRepo] [--base=URL] [--no-public] [--weeks=N]
// Examples:
//   node scripts/seed-fleet.mjs                      # 60 repos × 8 scans into "acme" + curated public
//   node scripts/seed-fleet.mjs acme 120 10          # a bigger fleet
//   node scripts/seed-fleet.mjs acme 60 8 --base=https://ascent.vercel.app   # seed a deployed instance
// Env: ASCENT_BASE_URL (default http://localhost:3000), ASCENT_SEED_SECRET (sent as x-seed-secret).

import http from "node:http";
import https from "node:https";

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const positional = args.filter((a) => !a.startsWith("--"));

const base = (flags.base || process.env.ASCENT_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const org = positional[0] || "acme";
const repoCount = Number(positional[1] || 60);
const scansPerRepo = Number(positional[2] || 8);
const weeksBack = Number(flags.weeks || 12);
const includePublic = flags["no-public"] ? false : true;

const payload = JSON.stringify({ org, repoCount, scansPerRepo, weeksBack, includePublic });
const url = new URL(`${base}/api/dev/seed-fleet`);
const lib = url.protocol === "https:" ? https : http;

const req = lib.request(
  url,
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
      ...(process.env.ASCENT_SEED_SECRET ? { "x-seed-secret": process.env.ASCENT_SEED_SECRET } : {}),
    },
    timeout: 290_000,
  },
  (res) => {
    let buf = "";
    res.on("data", (c) => (buf += c));
    res.on("end", () => {
      try {
        const json = JSON.parse(buf);
        console.log(`[seed-fleet] ${res.statusCode}`, JSON.stringify(json, null, 2));
      } catch {
        console.log(`[seed-fleet] ${res.statusCode}`, buf.slice(0, 500));
      }
      process.exit(res.statusCode && res.statusCode < 400 ? 0 : 1);
    });
  },
);

req.on("error", (err) => {
  console.error(`[seed-fleet] request failed: ${err.message}`);
  console.error("Is the dev server running?  npm run dev");
  process.exit(1);
});
req.on("timeout", () => {
  console.error("[seed-fleet] timed out after 290s — try a smaller repoCount/scansPerRepo");
  req.destroy();
  process.exit(1);
});

console.log(`[seed-fleet] POST ${url.href}  org=${org} repos=${repoCount} scans/repo=${scansPerRepo} public=${includePublic}`);
req.write(payload);
req.end();
