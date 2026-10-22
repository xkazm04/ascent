#!/usr/bin/env node
// Zero-dep test for `ascent work run`: every report_attempt carries the fence claim_followups
// returned for THAT id, so a report from a session whose lease lapsed cannot land on a newer claim.
// Run: node scripts/__tests__/ascent-work-fence.test.mjs
//
// Black-box on purpose: the real CLI runs against a stub MCP door, and what is asserted is the
// argument object each tools/call carried.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "ascent-work.mjs");
const FENCES = { "rec-1": "2026-10-22T10:45:00.000Z", "rec-2": "2026-10-22T10:45:00.001Z" };

async function stubDoor() {
  const calls = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { params } = JSON.parse(body);
      calls.push({ name: params.name, arguments: params.arguments });
      const structuredContent =
        params.name === "claim_followups"
          ? { claimed: Object.entries(FENCES).map(([id, fence]) => ({ id, leaseUntil: fence, fence })), refused: [] }
          : params.name === "report_attempt"
            ? { adjudication: "Recorded." }
            : {};
      const text = params.name === "get_fix_brief" ? "# brief" : JSON.stringify(structuredContent);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent, content: [{ type: "text", text }] } }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { calls, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

function runCli(args, env) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("close", (code) => resolveRun({ code, out }));
  });
}

test("run: each report_attempt carries the fence claim_followups returned for that id", async () => {
  const door = await stubDoor();
  try {
    const { code, out } = await runCli(["run", "--repo", "acme/api", "--", process.execPath, "-e", ""], {
      ASCENT_URL: door.url,
      ASCENT_TOKEN: "tok",
    });
    assert.equal(code, 0, out);
    const reports = door.calls.filter((c) => c.name === "report_attempt");
    assert.equal(reports.length, 2);
    for (const r of reports) assert.equal(r.arguments.fence, FENCES[r.arguments.id]);
  } finally {
    await door.close();
  }
});

test("report: --fence is passed through, and an absent one is not invented", async () => {
  const door = await stubDoor();
  try {
    const env = { ASCENT_URL: door.url, ASCENT_TOKEN: "tok" };
    const base = ["report", "--id", "rec-1", "--verdict", "skipped", "--reason", "covered"];
    assert.equal((await runCli([...base, "--fence", FENCES["rec-1"]], env)).code, 0);
    assert.equal((await runCli(base, env)).code, 0);
    const [fenced, unfenced] = door.calls.filter((c) => c.name === "report_attempt");
    assert.equal(fenced.arguments.fence, FENCES["rec-1"]);
    assert.equal("fence" in unfenced.arguments, false);
  } finally {
    await door.close();
  }
});
