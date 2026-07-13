#!/usr/bin/env node
// ascent-skills — a tiny, zero-dependency client for the Org Skills Library sync loop.
//
//   ascent-skills sync            pull changed skills into .claude/skills/ (diffs a local lockfile)
//   ascent-skills push [dir]      register/update local *.SKILL.md skills (optimistic concurrency)
//   ascent-skills list            print the org's skill manifest
//
// Config (flags override env):
//   --url   / ASCENT_URL     base URL of the ascent app          (default http://localhost:3000)
//   --org   / ASCENT_ORG     org slug
//   --token / ASCENT_TOKEN   an `askl_` API token (mint one in /org/<slug>/skills → API tokens)
//   --dir                    skills directory                    (default .claude/skills)
//   --repo  / ASCENT_REPO    reporting repo full name (owner/name) for telemetry (optional)
//
// Requires Node 18+ (global fetch). Distribute this single file in a repo; run from `postinstall` or CI.

import { readFile, writeFile, readdir, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const LOCK_FILE = "ascent-skills.lock.json";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { args[key] = next; i++; }
      else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

function config(args) {
  const url = (args.url || process.env.ASCENT_URL || "http://localhost:3000").replace(/\/+$/, "");
  const org = args.org || process.env.ASCENT_ORG;
  const token = args.token || process.env.ASCENT_TOKEN;
  const dir = resolve(args.dir || ".claude/skills");
  const repo = args.repo || process.env.ASCENT_REPO || null;
  if (!org) fail("Missing org. Pass --org or set ASCENT_ORG.");
  if (!token) fail("Missing token. Pass --token or set ASCENT_TOKEN (mint one in the Skills page).");
  return { url, org, token, dir, repo };
}

function fail(msg) { console.error(`ascent-skills: ${msg}`); process.exit(1); }

async function api(cfg, path, { method = "GET", body, raw = false } = {}) {
  const res = await fetch(`${cfg.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text }; }
  return { status: res.status, json };
}

function slug(name) {
  return (name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "skill");
}
function fileFor(name) { return `${slug(name)}.SKILL.md`; }

async function loadLock(dir) {
  const p = join(dir, LOCK_FILE);
  if (!existsSync(p)) return { skills: {} };
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return { skills: {} }; }
}
async function saveLock(dir, lock) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, LOCK_FILE), JSON.stringify(lock, null, 2) + "\n");
}

// Minimal frontmatter reader: pulls `name`, `description`, `category` from a leading --- ... --- block.
function readFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (m) for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

async function cmdList(cfg) {
  const { status, json } = await api(cfg, `/api/org/skills/manifest?org=${encodeURIComponent(cfg.org)}`);
  if (status !== 200) fail(`manifest failed (${status}): ${json.error || "unknown"}`);
  const skills = json.skills || [];
  if (!skills.length) { console.log("No skills in this org."); return; }
  for (const s of skills) console.log(`  v${s.version}  [${s.category}]  ${s.name}`);
  console.log(`\n${skills.length} skill(s).`);
}

async function cmdSync(cfg) {
  const { status, json } = await api(cfg, `/api/org/skills/manifest?org=${encodeURIComponent(cfg.org)}`);
  if (status !== 200) fail(`manifest failed (${status}): ${json.error || "unknown"}`);
  const manifest = json.skills || [];
  const lock = await loadLock(cfg.dir);
  await mkdir(cfg.dir, { recursive: true });

  const seen = new Set();
  const synced = [];
  let unchanged = 0;
  for (const s of manifest) {
    seen.add(s.id);
    const prev = lock.skills[s.id];
    if (prev && prev.contentHash === s.contentHash && existsSync(join(cfg.dir, prev.file))) { unchanged++; continue; }
    // Fetch the body WITHOUT counting a human "download" (we report a `sync` event below instead).
    const res = await api(cfg, `/api/org/skills/${s.id}/download?count=0`, { raw: true });
    if (res.status !== 200) { console.warn(`  ! skip ${s.name} (download ${res.status})`); continue; }
    const file = fileFor(s.name);
    // A rename changes the target file — remove the stale one so we don't leave an orphan copy.
    if (prev && prev.file && prev.file !== file && existsSync(join(cfg.dir, prev.file))) await rm(join(cfg.dir, prev.file));
    await writeFile(join(cfg.dir, file), await res.text());
    lock.skills[s.id] = { name: s.name, version: s.version, contentHash: s.contentHash, file };
    synced.push(s);
    console.log(`  ↓ ${s.name}  (v${s.version})`);
  }

  // Prune skills that vanished from the manifest (archived/deleted server-side).
  for (const id of Object.keys(lock.skills)) {
    if (seen.has(id)) continue;
    const f = join(cfg.dir, lock.skills[id].file);
    if (existsSync(f)) await rm(f);
    console.log(`  ✗ removed ${lock.skills[id].name} (no longer published)`);
    delete lock.skills[id];
  }

  await saveLock(cfg.dir, lock);
  console.log(`\nSynced ${synced.length}, unchanged ${unchanged}. → ${cfg.dir}`);

  // Best-effort telemetry: report a `sync` per updated skill so the org can see pull activity.
  if (synced.length) {
    const events = synced.map((s) => ({ skillId: s.id, type: "sync", repo: cfg.repo, source: "cli" }));
    await api(cfg, `/api/org/skills/events`, { method: "POST", body: { org: cfg.org, events } }).catch(() => {});
  }
}

async function cmdPush(cfg, dirArg) {
  const dir = dirArg ? resolve(dirArg) : cfg.dir;
  if (!existsSync(dir)) fail(`directory not found: ${dir}`);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".SKILL.md"));
  if (!files.length) { console.log(`No *.SKILL.md files in ${dir}.`); return; }
  const lock = await loadLock(cfg.dir);
  // name -> lock entry, so we can send the baseVersion the CLI last knew for optimistic concurrency.
  const byName = new Map(Object.entries(lock.skills).map(([id, v]) => [v.name, { id, ...v }]));

  let created = 0, updated = 0, unchanged = 0, conflicts = 0;
  for (const f of files) {
    const content = await readFile(join(dir, f), "utf8");
    const fm = readFrontmatter(content);
    const name = fm.name || f.replace(/\.SKILL\.md$/i, "");
    const prev = byName.get(name);
    const body = {
      org: cfg.org,
      name,
      content,
      category: fm.category,
      description: fm.description,
      ...(prev ? { baseVersion: prev.version } : {}),
    };
    const { status, json } = await api(cfg, `/api/org/skills/push`, { method: "POST", body });
    if (status === 409) { console.warn(`  ! conflict ${name}: ${json.error || "stale"} — run sync first`); conflicts++; continue; }
    if (status !== 200) { console.warn(`  ! failed ${name} (${status}): ${json.error || "unknown"}`); continue; }
    if (json.status === "created") created++;
    else if (json.status === "updated") updated++;
    else unchanged++;
    if (json.id) lock.skills[json.id] = { name, version: json.version, contentHash: contentHashHint(prev, json), file: f };
    console.log(`  ↑ ${name}  (${json.status} v${json.version})`);
  }
  await saveLock(cfg.dir, lock);
  console.log(`\nPushed: ${created} created, ${updated} updated, ${unchanged} unchanged, ${conflicts} conflict(s).`);
}

// After a push the server doesn't echo the contentHash; a following `sync` reconciles it. Keep the prior
// hash when unchanged so the lock isn't needlessly dirtied.
function contentHashHint(prev, json) {
  return json.status === "unchanged" && prev ? prev.contentHash : "";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === "help" || args.help) {
    console.log("Usage: ascent-skills <sync|push|list> [--org <slug>] [--token <askl_…>] [--url <base>] [--dir <path>] [--repo <owner/name>]");
    process.exit(cmd ? 0 : 1);
  }
  const cfg = config(args);
  if (cmd === "sync") await cmdSync(cfg);
  else if (cmd === "push") await cmdPush(cfg, args._[1]);
  else if (cmd === "list") await cmdList(cfg);
  else fail(`unknown command: ${cmd}`);
}

main().catch((e) => fail(e?.message || String(e)));
