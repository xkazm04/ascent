// Seed the local PGlite DB with REAL scans by driving the running dev server's /api/scan endpoint —
// the exact production path (deterministic detectors + the configured LLM provider + persistence).
// With LLM_PROVIDER=claude-cli in .env, the assessment is produced by the local `claude` CLI under
// your subscription, so the persisted data is production-like (not the mock floor).
//
// Uses node:http (not fetch): a claude-cli scan can take 5–10 min, and Node's global fetch aborts at
// undici's 300s headers-timeout — which disconnects the client, makes the server abort the scan, and
// nothing persists. node:http holds the connection with no idle timeout; one overall guard caps it.
//
// Prereqs: `next dev` is up with the new .env (PGLITE + claude-cli). Usage:
//   node scripts/seed-scans.mjs [baseUrl] [repo ...]

import http from "node:http";

const baseArg = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:3001";
const base = new URL(baseArg);
const extra = process.argv.slice(process.argv[2]?.startsWith("http") ? 3 : 2);

const REPOS = extra.length
  ? extra
  : ["anthropics/claude-code", "vercel/swr", "prisma/prisma", "tailwindlabs/tailwindcss", "vercel/turbo"];

const PER_REPO_TIMEOUT_MS = 780_000; // 13 min — covers the 600s LLM budget + ingest

function post(repo) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ url: `https://github.com/${repo}`, fresh: true });
    const req = http.request(
      {
        hostname: base.hostname,
        port: base.port || 80,
        path: "/api/scan",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        });
      },
    );
    const timer = setTimeout(() => req.destroy(new Error("overall timeout")), PER_REPO_TIMEOUT_MS);
    req.on("error", (e) => {
      clearTimeout(timer);
      resolve({ error: e.message });
    });
    req.write(body);
    req.end();
  });
}

async function scan(repo) {
  const started = Date.now();
  const r = await post(repo);
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  if (r.error) {
    console.log(`✗ ${repo.padEnd(28)} ${r.error} (${secs}s)`);
    return false;
  }
  if (r.status !== 200) {
    console.log(`✗ ${repo.padEnd(28)} HTTP ${r.status} (${secs}s) ${String(r.body).slice(0, 140)}`);
    return false;
  }
  let rep = {};
  try { rep = JSON.parse(r.body); } catch {}
  const provider = rep?.engine?.provider ?? "?";
  const overall = rep?.overallScore ?? "?";
  const level = rep?.level?.id ?? rep?.level ?? "?";
  const cache = r.headers["x-ascent-cache"];
  const persisted = r.headers["x-ascent-persisted"] ?? "true";
  const flag = provider === "mock" ? "  ⚠ MOCK (claude-cli failed?)" : persisted === "false" ? "  ⚠ NOT PERSISTED" : "";
  console.log(
    `✓ ${repo.padEnd(28)} L=${String(level).padEnd(3)} score=${String(overall).padEnd(3)} ` +
      `engine=${provider} cache=${cache} persisted=${persisted} (${secs}s)${flag}`,
  );
  return provider !== "mock" && persisted !== "false";
}

console.log(`Seeding ${REPOS.length} repos via ${base.origin}/api/scan (sequential)…\n`);
let ok = 0;
for (const repo of REPOS) if (await scan(repo)) ok++;
console.log(`\nDone: ${ok}/${REPOS.length} real (non-mock) scans persisted.`);
process.exit(ok > 0 ? 0 : 1);
