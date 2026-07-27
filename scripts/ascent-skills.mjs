#!/usr/bin/env node
// ascent-skills — a tiny, zero-dependency client for the Org Skills Library sync loop.
//
//   ascent-skills sync            pull changed skills into .claude/skills/ (diffs a local lockfile)
//   ascent-skills push [dir]      register/update local *.SKILL.md skills (optimistic concurrency)
//   ascent-skills list            print the org's skill manifest
//   ascent-skills status          per-skill drift table: in_sync | diverged | stale | local_only | missing
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
import { createHash } from "node:crypto";
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

// ---- sync_state: three hashes, one verdict -----------------------------------
// The server's contentHash is sha256 of the STORED body, and /download serves exactly that body — so the
// sha256 of the local file is directly comparable to both the lockfile hash (what we last pulled) and the
// remote hash (what the library holds now). Three hashes give the whole drift picture:
//
//   local == lock == remote   in_sync     nothing to do
//   local != lock             diverged    someone edited the file here; a sync would clobber it
//   lock  != remote           stale       the library moved on; sync to pick it up
//   no lock entry, no remote  local_only  a locally authored skill — `push` it to share it
//   lock entry, file gone     missing     deleted locally; sync restores it
//
// A skill can be diverged AND stale; `diverged` wins because local edits are the state that loses work.

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function skillState({ hasLock, fileExists, localHash, lockHash, remoteHash }) {
  if (!hasLock && !remoteHash) return "local_only";
  if (hasLock && !fileExists) return "missing";
  // A push writes the lock entry before the next manifest read, leaving the hash blank (see
  // contentHashHint) — treat an unknown lock hash as "not yet reconciled", never as a local edit.
  if (hasLock && !lockHash) return localHash && localHash === remoteHash ? "in_sync" : "stale";
  if (!hasLock) return fileExists && localHash !== remoteHash ? "diverged" : "stale";
  if (localHash !== lockHash) return "diverged";
  if (lockHash !== remoteHash) return "stale";
  return "in_sync";
}

/** Hash every *.SKILL.md in the skills dir → Map<file, sha256>. */
async function localHashes(dir) {
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const f of (await readdir(dir)).filter((f) => f.endsWith(".SKILL.md"))) {
    out.set(f, sha256(await readFile(join(dir, f), "utf8")));
  }
  return out;
}

/** One row per skill known to EITHER side (plus untracked local files), with its sync_state. */
async function collectStates(cfg, manifest) {
  const lock = await loadLock(cfg.dir);
  const hashes = await localHashes(cfg.dir);
  const byId = new Map(manifest.map((s) => [s.id, s]));
  const ids = new Set([...Object.keys(lock.skills), ...byId.keys()]);
  const claimed = new Set();
  const rows = [];
  for (const id of ids) {
    const prev = lock.skills[id];
    const remote = byId.get(id);
    const file = prev?.file ?? (remote ? fileFor(remote.name) : null);
    if (file) claimed.add(file);
    const localHash = file ? (hashes.get(file) ?? null) : null;
    rows.push({
      id,
      name: remote?.name ?? prev?.name ?? id,
      file,
      lockVersion: prev?.version ?? null,
      remoteVersion: remote?.version ?? null,
      state: skillState({
        hasLock: Boolean(prev),
        fileExists: Boolean(localHash),
        localHash,
        lockHash: prev?.contentHash ?? null,
        remoteHash: remote?.contentHash ?? null,
      }),
    });
  }
  // Anything on disk the lockfile/library never claimed: authored here, not shared yet.
  for (const [file] of hashes) {
    if (claimed.has(file)) continue;
    rows.push({ id: null, name: file.replace(/\.SKILL\.md$/i, ""), file, lockVersion: null, remoteVersion: null, state: "local_only" });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function countStates(rows) {
  const counts = { in_sync: 0, diverged: 0, stale: 0, local_only: 0, missing: 0 };
  for (const r of rows) counts[r.state] = (counts[r.state] ?? 0) + 1;
  return counts;
}

const pad = (s, n) => String(s ?? "").padEnd(n);

async function cmdStatus(cfg) {
  const { status, json } = await api(cfg, `/api/org/skills/manifest?org=${encodeURIComponent(cfg.org)}`);
  if (status !== 200) fail(`manifest failed (${status}): ${json.error || "unknown"}`);
  const rows = await collectStates(cfg, json.skills || []);
  if (!rows.length) { console.log(`No skills locally or in the library. → ${cfg.dir}`); return; }
  const w = Math.max(6, ...rows.map((r) => r.name.length));
  console.log(`${pad("SKILL", w)}  ${pad("STATE", 11)}  ${pad("LOCK", 6)}  REMOTE`);
  for (const r of rows) {
    console.log(
      `${pad(r.name, w)}  ${pad(r.state, 11)}  ${pad(r.lockVersion ? `v${r.lockVersion}` : "—", 6)}  ${r.remoteVersion ? `v${r.remoteVersion}` : "—"}`,
    );
  }
  const c = countStates(rows);
  console.log(
    `\n${rows.length} skill(s): ${c.in_sync} in sync, ${c.diverged} diverged, ${c.stale} stale, ${c.local_only} local-only, ${c.missing} missing. → ${cfg.dir}`,
  );
  if (c.diverged) console.log("Diverged = locally edited since the last sync; `push` to share the edit, or `sync` to discard it.");
  if (c.local_only) console.log("Local-only = authored here and never published; `push` to add it to the library.");
}

/**
 * Best-effort drift telemetry: one `sync` event per DRIFTED skill, tagged with the state in `source`, so
 * the org can see where the fleet diverged from the library without shipping any file content. Never
 * throws and never blocks — a telemetry outage must not fail a sync that already succeeded on disk.
 */
async function reportDrift(cfg, rows) {
  const drifted = rows.filter((r) => r.id && (r.state === "diverged" || r.state === "stale" || r.state === "missing"));
  if (!drifted.length) return;
  try {
    const events = drifted.map((r) => ({ skillId: r.id, type: "sync", repo: cfg.repo, source: `cli:${r.state}` }));
    const { status } = await api(cfg, `/api/org/skills/events`, { method: "POST", body: { org: cfg.org, events } });
    if (status !== 200) console.warn(`  ! drift telemetry not recorded (${status})`);
  } catch (e) {
    console.warn(`  ! drift telemetry failed: ${e?.message || e}`);
  }
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

  // Drift snapshot BEFORE we touch the tree: after the pull every state collapses to in_sync (except the
  // untouched diverged files), so this is the only moment the pre-sync picture exists.
  const before = await collectStates(cfg, manifest);
  const divergedIds = new Set(before.filter((r) => r.state === "diverged" && r.id).map((r) => r.id));

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
    // Local edits are about to be overwritten by the library copy — say so loudly rather than silently
    // eating someone's work (the lockfile hash is what proves the file was edited, not just stale).
    if (divergedIds.has(s.id)) console.warn(`  ! ${s.name}: local edits overwritten by v${s.version} — push next time to keep them`);
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
  const drift = countStates(before);
  console.log(`\nSynced ${synced.length}, unchanged ${unchanged}. → ${cfg.dir}`);
  console.log(
    `Drift before sync: ${drift.in_sync} in sync, ${drift.diverged} diverged, ${drift.stale} stale, ${drift.local_only} local-only, ${drift.missing} missing.`,
  );

  // Best-effort telemetry: report a `sync` per updated skill so the org can see pull activity.
  if (synced.length) {
    const events = synced.map((s) => ({ skillId: s.id, type: "sync", repo: cfg.repo, source: "cli" }));
    await api(cfg, `/api/org/skills/events`, { method: "POST", body: { org: cfg.org, events } }).catch(() => {});
  }
  // …and the drift picture alongside it. Warn-only: the sync already succeeded on disk.
  await reportDrift(cfg, before);
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
    console.log("Usage: ascent-skills <sync|push|list|status> [--org <slug>] [--token <askl_…>] [--url <base>] [--dir <path>] [--repo <owner/name>]");
    process.exit(cmd ? 0 : 1);
  }
  const cfg = config(args);
  if (cmd === "sync") await cmdSync(cfg);
  else if (cmd === "push") await cmdPush(cfg, args._[1]);
  else if (cmd === "list") await cmdList(cfg);
  else if (cmd === "status") await cmdStatus(cfg);
  else fail(`unknown command: ${cmd}`);
}

main().catch((e) => fail(e?.message || String(e)));
