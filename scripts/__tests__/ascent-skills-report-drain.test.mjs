#!/usr/bin/env node
// Zero-dep tests for `report`'s spool watermark: the offset may only move past what the server acknowledged.
// Run: node scripts/__tests__/ascent-skills-report-drain.test.mjs
//
// Black-box on purpose: each case runs the real CLI in a scratch cwd against a stub events server, so what
// is measured is what a user's spool loses, not what a helper returns. Three ways a successful report can
// advance the offset past events it never sent - the per-call cap, a hook appending while the report runs,
// and a line the hook was still writing when the spool was read - and two floors that must not move.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "ascent-skills.mjs");
const SKILL = "demo-skill";

const line = (i) => JSON.stringify({ skill: SKILL, session: "s1", ts: `2026-09-17T00:00:${String(i).padStart(6, "0")}Z` }) + "\n";

/** A stub of the two endpoints `report` calls. `onEvents` may mutate the spool while the POST is in flight. */
async function stub({ onEvents, status = 200 } = {}) {
  const received = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/api/org/skills/manifest")) {
        res.end(JSON.stringify({ skills: [{ id: "sk_1", name: SKILL, version: 1, category: "x" }] }));
        return;
      }
      if (req.url.startsWith("/api/org/skills/events")) {
        const events = JSON.parse(body).events;
        if (onEvents) onEvents(events);
        if (status !== 200) { res.statusCode = status; res.end(JSON.stringify({ error: "boom" })); return; }
        received.push(...events);
        res.end(JSON.stringify({ recorded: events.length }));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { received, url, close: () => new Promise((r) => server.close(r)) };
}

function scratch(lines) {
  const cwd = mkdtempSync(join(tmpdir(), "ascent-drain-"));
  mkdirSync(join(cwd, ".ascent"), { recursive: true });
  const spool = join(cwd, ".ascent", "skill-events.jsonl");
  writeFileSync(spool, lines.join(""));
  return { cwd, spool };
}

// A synchronous spawn would block the stub's event loop, so the CLI runs async.
function report(cwd, url) {
  return new Promise((done) => {
    const p = spawn(process.execPath, [CLI, "report", "--org", "o", "--token", "askl_test", "--url", url], { cwd });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => done({ code, out }));
  });
}

const uniq = (events) => new Set(events.map((e) => e.ts)).size;

test("positive control: a small spool is delivered once and the rerun sends nothing", async () => {
  const s = await stub();
  const { cwd } = scratch([line(1), line(2), line(3)]);
  try {
    await report(cwd, s.url);
    const second = await report(cwd, s.url);
    assert.equal(s.received.length, 3, "the stub hears every event");
    assert.equal(uniq(s.received), 3, "no duplicates");
    assert.match(second.out, /Nothing to report/);
  } finally { await s.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test("a failed report drains nothing, and the rerun delivers everything", async () => {
  const failing = await stub({ status: 500 });
  const { cwd } = scratch([line(1), line(2)]);
  try {
    await report(cwd, failing.url);
    await failing.close();
    const ok = await stub();
    await report(cwd, ok.url);
    assert.equal(uniq(ok.received), 2);
    await ok.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("the per-call cap does not drain the events past it", async () => {
  const s = await stub();
  const { cwd } = scratch(Array.from({ length: 510 }, (_, i) => line(i)));
  try {
    await report(cwd, s.url);
    await report(cwd, s.url);
    const lost = 510 - uniq(s.received);
    console.log(`# cap: delivered ${uniq(s.received)} of 510, lost ${lost}, duplicates ${s.received.length - uniq(s.received)}`);
    assert.equal(lost, 0, "events beyond the first batch were marked reported and never sent");
    assert.equal(s.received.length, uniq(s.received), "no duplicates");
  } finally { await s.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test("events the hook appends while a report is in flight are not drained", async () => {
  let appended = false;
  let spoolPath;
  const s = await stub({
    onEvents: () => {
      if (appended) return;
      appended = true;
      appendFileSync(spoolPath, line(100) + line(101));
    },
  });
  const { cwd, spool } = scratch([line(1), line(2)]);
  spoolPath = spool;
  try {
    await report(cwd, s.url);
    await report(cwd, s.url);
    const lost = 4 - uniq(s.received);
    console.log(`# append: delivered ${uniq(s.received)} of 4, lost ${lost}`);
    assert.equal(lost, 0, "lines appended mid-report were skipped by the watermark");
  } finally { await s.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test("a line still being written when the spool is read is not drained", async () => {
  const { cwd, spool } = scratch([line(1)]);
  const torn = line(200);
  appendFileSync(spool, torn.slice(0, 20)); // the hook is mid-append when report reads
  const s = await stub();
  try {
    await report(cwd, s.url);
    appendFileSync(spool, torn.slice(20)); // the hook finishes its line
    await report(cwd, s.url);
    const lost = 2 - uniq(s.received);
    console.log(`# torn: delivered ${uniq(s.received)} of 2, lost ${lost}`);
    assert.equal(lost, 0, "the completed line sat behind the watermark");
  } finally { await s.close(); rmSync(cwd, { recursive: true, force: true }); }
});
