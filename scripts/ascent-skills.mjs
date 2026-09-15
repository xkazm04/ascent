#!/usr/bin/env node
// ascent-skills — a tiny, zero-dependency client for the Org Skills Library sync loop.
//
//   ascent-skills sync            pull changed skills into .claude/skills/ (diffs a local lockfile)
//   ascent-skills push [dir]      register/update local *.SKILL.md skills (optimistic concurrency)
//   ascent-skills list            print the org's skill manifest
//   ascent-skills status          per-skill drift table: in_sync | diverged | stale | local_only | missing
//   ascent-skills hooks install   install the PreToolUse `Skill` hook that records local invocations
//   ascent-skills hooks remove    remove ONLY the hook entries this tool installed
//   ascent-skills hooks status    installed/absent + how many events are waiting to be reported
//   ascent-skills report          drain .ascent/skill-events.jsonl to the org (sink A)
//   ascent-skills report --to-registry --contributor <id>
//                                 write/merge usage/<contributor>.json in a registry checkout (sink B)
//
// Config (flags override env):
//   --url   / ASCENT_URL     base URL of the ascent app          (default http://localhost:3000)
//   --org   / ASCENT_ORG     org slug
//   --token / ASCENT_TOKEN   an `askl_` API token (mint one in /org/<slug>/skills → API tokens)
//   --dir                    skills directory                    (default .claude/skills)
//   --repo  / ASCENT_REPO    reporting repo full name (owner/name) for telemetry (optional)
//
// Requires Node 18+ (global fetch). Distribute this single file in a repo; run from `postinstall` or CI.

import { readFile, writeFile, readdir, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOCK_FILE = "ascent-skills.lock.json";

// ── the local invoke channel (#19) ────────────────────────────────────────────────────────────────
// Everything the hook touches lives under .ascent/ in the PROJECT, not in the user's home: telemetry
// about a repo belongs to that repo's checkout, and a machine-global spool would mix repos that have
// different owners and different privacy postures.
export const ASCENT_DIR = ".ascent";
export const EVENTS_FILE = `${ASCENT_DIR}/skill-events.jsonl`;
export const OFFSET_FILE = `${ASCENT_DIR}/skill-events.offset`;
export const HOOK_FILE = `${ASCENT_DIR}/skill-hook.mjs`;
export const SETTINGS_FILE = ".claude/settings.json";
/** Marks the entries this tool owns. `hooks remove` deletes ONLY these — someone else's PreToolUse
 *  hook on `Skill` is not ours to take away, and an uninstall that ate one would be unforgivable. */
export const HOOK_MARKER = "_ascent";
const MAX_REPORT_BATCH = 500;

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
    // `source` is a closed vocabulary server-side now; the drift state moves to its own `detail`
    // field rather than being smuggled after a colon. Old clients still work — the server normalizes
    // `cli:<state>` by prefix — but nothing new should rely on that.
    const events = drifted.map((r) => ({ skillId: r.id, type: "sync", repo: cfg.repo, source: "cli", detail: r.state }));
    const { status } = await api(cfg, `/api/org/skills/events`, { method: "POST", body: { org: cfg.org, events } });
    if (status !== 200) console.warn(`  ! drift telemetry not recorded (${status})`);
  } catch (e) {
    console.warn(`  ! drift telemetry failed: ${e?.message || e}`);
  }
}

// ── hooks: the invoke producer ────────────────────────────────────────────────────────────────────
//
// The hook is EMITTED from a template rather than shelled out to this file, so it never depends on
// where the CLI lives (a global install, a vendored copy, npx — all different paths, all fine). It is
// deliberately tiny and deliberately incapable: it appends one line and exits 0 unconditionally. It
// never blocks a tool call, never reads the prompt, never reads file content and never phones home.
// The network hop is `report`, which a human or a CI job runs on purpose.
export const SKILL_HOOK_TEMPLATE = `#!/usr/bin/env node
// Generated by \`ascent-skills hooks install\`. Records that a Skill ran; nothing else.
// It must NEVER block the tool call, so every failure path still exits 0.
import { appendFile, mkdir } from "node:fs/promises";
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
try {
  const input = JSON.parse(raw || "{}");
  const skill = input?.tool_input?.skill ?? input?.tool_input?.name ?? null;
  if (skill) {
    await mkdir(".ascent", { recursive: true });
    const line = JSON.stringify({
      skill,
      event: "invoke",
      ts: new Date().toISOString(),
      session: input?.session_id ?? null,
    });
    await appendFile(".ascent/skill-events.jsonl", line + "\\n");
  }
} catch {
  /* telemetry must never break a tool call */
}
process.exit(0);
`;

const hookEntry = () => ({
  [HOOK_MARKER]: true,
  matcher: "Skill",
  hooks: [{ type: "command", command: `node ${HOOK_FILE}` }],
});

/** Is a PreToolUse entry one of ours? Identity is the MARKER, never the matcher or the command — a
 *  project may well have its own `Skill` hook, and a command string is edited all the time. */
export const isOurHook = (entry) => Boolean(entry && entry[HOOK_MARKER] === true);

/** Add our entry to a settings object, idempotently. Returns `{ settings, changed }`. */
export function withSkillHook(settings) {
  const next = { ...(settings ?? {}) };
  const hooks = { ...(next.hooks ?? {}) };
  const pre = Array.isArray(hooks.PreToolUse) ? [...hooks.PreToolUse] : [];
  if (pre.some(isOurHook)) return { settings: settings ?? {}, changed: false };
  pre.push(hookEntry());
  hooks.PreToolUse = pre;
  next.hooks = hooks;
  return { settings: next, changed: true };
}

/** Remove ONLY our entries. Foreign hooks — including another `Skill` matcher — are untouched. */
export function withoutSkillHook(settings) {
  const pre = settings?.hooks?.PreToolUse;
  if (!Array.isArray(pre)) return { settings: settings ?? {}, changed: false, removed: 0 };
  const kept = pre.filter((e) => !isOurHook(e));
  if (kept.length === pre.length) return { settings, changed: false, removed: 0 };
  const hooks = { ...settings.hooks };
  if (kept.length) hooks.PreToolUse = kept;
  else delete hooks.PreToolUse;
  const next = { ...settings, hooks };
  if (!Object.keys(hooks).length) delete next.hooks;
  return { settings: next, changed: true, removed: pre.length - kept.length };
}

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

async function cmdHooks(args) {
  const sub = args._[1] || "status";
  const settings = await readJson(SETTINGS_FILE, {});
  if (sub === "install") {
    const { settings: next, changed } = withSkillHook(settings);
    await mkdir(".claude", { recursive: true });
    await mkdir(ASCENT_DIR, { recursive: true });
    await writeFile(HOOK_FILE, SKILL_HOOK_TEMPLATE);
    if (changed) await writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2) + "\n");
    console.log(changed ? `Installed the Skill invoke hook → ${SETTINGS_FILE}` : "Already installed.");
    console.log(`Events spool to ${EVENTS_FILE}; run \`ascent-skills report\` to send them.`);
    return;
  }
  if (sub === "remove") {
    const { settings: next, changed, removed } = withoutSkillHook(settings);
    if (changed) await writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2) + "\n");
    if (existsSync(HOOK_FILE)) await rm(HOOK_FILE);
    // The spool is NOT deleted: it may hold events nobody has reported yet, and throwing away
    // somebody's unsent telemetry to tidy up is not this command's call.
    console.log(changed ? `Removed ${removed} ascent hook entry(ies).` : "Nothing of ours was installed.");
    return;
  }
  if (sub === "status") {
    const installed = Array.isArray(settings?.hooks?.PreToolUse) && settings.hooks.PreToolUse.some(isOurHook);
    const pending = (await pendingEvents()).length;
    console.log(`hook:    ${installed ? "installed" : "absent"}${existsSync(HOOK_FILE) ? "" : " (script missing)"}`);
    console.log(`spool:   ${existsSync(EVENTS_FILE) ? EVENTS_FILE : "none"}`);
    console.log(`pending: ${pending} event(s) since the last report`);
    return;
  }
  fail(`unknown hooks subcommand: ${sub} (install|remove|status)`);
}

// ── report: drain the spool ───────────────────────────────────────────────────────────────────────
//
// The spool is drained by BYTE WATERMARK, not by truncation: the hook may append while `report` is
// running, and truncating would silently eat whatever landed in between. The offset also makes the
// file a readable local log rather than a queue that destroys itself.

/** Parse the spool from `offset` bytes on. Returns `{ events, offset }`. */
export function parseSpool(text) {
  const events = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e.skill === "string" && e.skill) events.push(e);
    } catch {
      /* a torn line (the hook was killed mid-append) is skipped, never fatal */
    }
  }
  return events;
}

/** Drop repeats of (session, skill, ts) — the same identity the server dedupes on. */
export function dedupeEvents(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const key = `${e.session ?? ""}|${e.skill}|${e.ts ?? ""}`;
    if (e.session && seen.has(key)) continue;
    if (e.session) seen.add(key);
    out.push(e);
  }
  return out;
}

async function pendingEvents() {
  if (!existsSync(EVENTS_FILE)) return [];
  const offset = Number(await readFile(OFFSET_FILE, "utf8").catch(() => "0")) || 0;
  const size = (await stat(EVENTS_FILE)).size;
  if (size <= offset) return [];
  const text = (await readFile(EVENTS_FILE)).subarray(offset).toString("utf8");
  return dedupeEvents(parseSpool(text));
}

/**
 * Fold events into the `usage/<contributor>.json` shape — SINK B.
 *
 * Counts only. No repo, no path, no login, no per-project breakdown: the registry's usage lane
 * forbids all of it (`docs/usage-lane.md`) and its own `scripts/check-usage.mjs` enforces it on what
 * is usually a PUBLIC repo. This function is the client-side half of that gate.
 */
export function aggregateForRegistry(events, contributor, opts = {}) {
  const skills = {};
  for (const e of events) {
    const prev = skills[e.skill] ?? { invokes: 0, lastUsed: null };
    prev.invokes += 1;
    if (e.ts && (!prev.lastUsed || e.ts > prev.lastUsed)) prev.lastUsed = e.ts;
    skills[e.skill] = prev;
  }
  // Merge onto whatever the file already holds — a contributor reports a running total, and a
  // replacement would throw away every count made before this drain.
  const prior = opts.previous?.skills ?? {};
  for (const [name, v] of Object.entries(prior)) {
    const mine = skills[name];
    if (!mine) { skills[name] = { invokes: v.invokes ?? 0, lastUsed: v.lastUsed ?? null }; continue; }
    mine.invokes += v.invokes ?? 0;
    if (v.lastUsed && (!mine.lastUsed || v.lastUsed > mine.lastUsed)) mine.lastUsed = v.lastUsed;
  }
  return {
    schema: "rkb-usage/1",
    contributor,
    app: "ascent",
    generatedAt: opts.now ?? new Date().toISOString(),
    windowDays: 30,
    skills,
  };
}

/**
 * The usage-lane gate, enforced BEFORE anything is written into a repo the operator may have made
 * public. A `/` is a repo or a path; an `@` is an email or a scoped package — either would be a
 * disclosure the lane's contract promises never happens. Refusing to write is the only safe answer:
 * scrubbing would publish whatever the scrub missed.
 */
export function assertUsageLaneSafe(payload) {
  const offenders = [];
  // The ONE exemption, named rather than pattern-matched: the lane's own schema tag is literally
  // `rkb-usage/1`. Exempting a fixed path keeps the hole exactly one value wide; exempting "anything
  // that looks like a version" would eventually let a repo name through wearing a slash.
  const EXEMPT = new Set(["usage.schema"]);
  const walk = (v, path) => {
    if (EXEMPT.has(path)) return;
    if (typeof v === "string") {
      if (v.includes("/") || v.includes("@")) offenders.push(`${path} = ${JSON.stringify(v)}`);
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k.includes("/") || k.includes("@")) offenders.push(`${path}.${k} (key)`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(payload, "usage");
  if (offenders.length) {
    throw new Error(
      `refusing to write usage/: the registry lane forbids repo names, paths and addresses — ${offenders.join("; ")}`,
    );
  }
  return true;
}

async function cmdReport(args, cfgFor) {
  const events = await pendingEvents();
  const dry = Boolean(args["dry-run"]);
  if (!events.length) { console.log("Nothing to report."); return; }

  if (args["to-registry"]) {
    const contributor = args.contributor || process.env.ASCENT_CONTRIBUTOR;
    if (!contributor) fail("Missing contributor. Pass --contributor or set ASCENT_CONTRIBUTOR.");
    const dir = resolve(args.registry || process.env.ASCENT_REGISTRY || "../ai-registry");
    const file = join(dir, "usage", `${contributor}.json`);
    const previous = await readJson(file, null);
    const payload = aggregateForRegistry(events, contributor, { previous });
    assertUsageLaneSafe(payload);
    if (dry) { console.log(JSON.stringify(payload, null, 2)); return; }
    await mkdir(join(dir, "usage"), { recursive: true });
    await writeFile(file, JSON.stringify(payload, null, 2) + "\n");
    await drain();
    console.log(`Wrote ${Object.keys(payload.skills).length} skill(s) → ${file}`);
    console.log("Counts only — no repo, no path, no login. Commit it yourself when you're ready.");
    return;
  }

  const cfg = cfgFor();
  // The hook records a NAME (it is the only thing a PreToolUse payload carries); the events API keys
  // on the library's id. The manifest is the map. A name the library does not publish is reported as
  // skipped rather than guessed at — inventing an id would attribute someone's run to another skill.
  const { status: mStatus, json: manifest } = await api(cfg, `/api/org/skills/manifest?org=${encodeURIComponent(cfg.org)}`);
  if (mStatus !== 200) fail(`manifest failed (${mStatus}): ${manifest.error || "unknown"}`);
  const idByName = new Map((manifest.skills || []).map((sk) => [sk.name, sk.id]));
  const resolved = [];
  const unknown = new Set();
  for (const e of events) {
    const id = e.skillId ?? idByName.get(e.skill);
    if (!id) { unknown.add(e.skill); continue; }
    resolved.push({ ...e, skillId: id });
  }
  if (unknown.size) console.warn(`  ! not in the library, skipped: ${Array.from(unknown).join(", ")}`);
  if (!resolved.length) { console.log("No reportable events (nothing matched the library)."); return; }
  const batch = resolved.slice(0, MAX_REPORT_BATCH);
  const body = {
    org: cfg.org,
    events: batch.map((e) => ({
      skillId: e.skillId,
      type: "invoke",
      repo: cfg.repo,
      source: "hook",
      session: e.session ?? null,
      ts: e.ts ?? null,
    })),
  };
  if (dry) { console.log(JSON.stringify(body, null, 2)); return; }
  const { status, json } = await api(cfg, `/api/org/skills/events`, { method: "POST", body });
  if (status !== 200) fail(`report failed (${status}): ${json.error || "unknown"}`);
  // Drain only after the server acknowledged. A failed report leaves the watermark where it was, so
  // the next run re-sends — at-least-once, which the server's dedupe key turns into exactly-once.
  await drain();
  console.log(`Reported ${json.recorded} of ${batch.length} event(s).`);
}

async function drain() {
  if (!existsSync(EVENTS_FILE)) return;
  const size = (await stat(EVENTS_FILE)).size;
  await mkdir(ASCENT_DIR, { recursive: true });
  await writeFile(OFFSET_FILE, String(size));
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
    console.log("Usage: ascent-skills <sync|push|list|status|hooks|report> [--org <slug>] [--token <askl_…>] [--url <base>] [--dir <path>] [--repo <owner/name>]");
    console.log("       ascent-skills hooks <install|remove|status>");
    console.log("       ascent-skills report [--to-registry --contributor <id> [--registry <path>]] [--dry-run]");
    process.exit(cmd ? 0 : 1);
  }
  // `hooks` is purely local and `report --to-registry` writes a file — neither needs an org or a
  // token, and demanding one would make the offline half of the loop unusable without an account.
  if (cmd === "hooks") return cmdHooks(args);
  if (cmd === "report") return cmdReport(args, () => config(args));
  const cfg = config(args);
  if (cmd === "sync") await cmdSync(cfg);
  else if (cmd === "push") await cmdPush(cfg, args._[1]);
  else if (cmd === "list") await cmdList(cfg);
  else if (cmd === "status") await cmdStatus(cfg);
  else fail(`unknown command: ${cmd}`);
}

// Run only when INVOKED, so the pure halves above can be imported by a test (or by another script)
// without the CLI trying to parse that process's argv and exiting.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => fail(e?.message || String(e)));
}
