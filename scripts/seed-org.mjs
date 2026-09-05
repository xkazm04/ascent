#!/usr/bin/env node
// Seed / demo helper: populate a public org's dashboard by scanning its repos.
//
//   node scripts/seed-org.mjs <org> [count]   [--live] [--no-watch] [--schedule=weekly] [--base=http://localhost:3000]
//
//   node scripts/seed-org.mjs vercel 20            # 20 newest public vercel repos, mock LLM
//   node scripts/seed-org.mjs vercel 20 --live     # use the real LLM provider (slower, costs)
//
// Drives POST /api/org/import (SSE) on a RUNNING dev/prod server that has DATABASE_URL
// (and ideally GITHUB_TOKEN) configured. Then open the printed dashboard URL.

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

const org = positional[0];
const count = positional[1] ? Number(positional[1]) : 20;
if (!org || Number.isNaN(count)) {
  console.error("usage: node scripts/seed-org.mjs <org> [count] [--live] [--no-watch] [--schedule=weekly] [--base=URL]");
  process.exit(1);
}

const base = (flags.base || process.env.ASCENT_BASE || "http://localhost:3000").toString().replace(/\/$/, "");
const body = {
  org,
  count,
  mock: !flags.live, // --live → real LLM; default mock (fast, deterministic, free)
  watch: flags["no-watch"] ? false : true,
  schedule: (flags.schedule || "weekly").toString(),
};

console.log(`Seeding ${org} (${count} repos, ${body.mock ? "mock" : "LIVE"} LLM, watch=${body.watch}, schedule=${body.schedule}) via ${base}`);

const res = await fetch(`${base}/api/org/import`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
if (!res.ok || !res.body) {
  console.error(`Request failed: ${res.status} ${res.statusText}`);
  console.error(await res.text().catch(() => ""));
  process.exit(1);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = "";
let ok = 0;
let failed = 0;

const handle = (event, data) => {
  if (event === "progress") {
    if (data.stage === "list") console.log(`  ${data.message}`);
    if (data.stage === "found") console.log(`  found ${data.total} repos — scanning…\n`);
  } else if (event === "repo") {
    if (data.error) {
      failed++;
      console.log(`  ✗ ${data.repo.padEnd(36)} ${data.error}`);
    } else {
      ok++;
      console.log(
        `  ✓ ${data.repo.padEnd(36)} ${String(data.level).padEnd(3)} overall=${String(data.overall).padStart(3)}` +
          `  adopt=${String(data.adoption).padStart(3)} rigor=${String(data.rigor).padStart(3)}` +
          `  ${String(data.posture).padEnd(10)} contribs=${data.contributors}`,
      );
    }
  } else if (event === "result") {
    console.log(`\nDone: ${data.scanned}/${data.total} scanned (${ok} ok, ${failed} failed).`);
    console.log(`Open: ${base}${data.dashboard}`);
  } else if (event === "error") {
    console.error(`\nERROR: ${data.error}`);
  }
};

for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const blocks = buf.split("\n\n");
  buf = blocks.pop() ?? "";
  for (const block of blocks) {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) continue;
    try {
      handle(event, JSON.parse(data));
    } catch {
      /* ignore keep-alive / partial */
    }
  }
}
