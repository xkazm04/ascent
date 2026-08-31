// Arm C / PRIYA-L1-701, LOCAL half. Start a local loop run, then poll GET /api/org/loop from a
// SECOND client while it is `running`, and record whether the read kills it. This is the control
// for the remote half: `markStaleRunsStopped` is pointed at every `running` row on every GET, and
// the ONLY thing that spares a run is a live-registry entry — which a local run gets and a remote
// run (by `startRemoteRun`'s own design) never does.
//
// Usage: node uat/driver/drive-armC-701-local.mjs <org> <repo> [probes]
// It STOPS the run it started, always — including on error (residue rule).
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const [org = "kiro", repo = "xkazm04/kp", probesArg = "6"] = process.argv.slice(2);
const probes = Number(probesArg);

const post = (body) =>
  fetch(`${BASE}/api/org/loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
const get = () => fetch(`${BASE}/api/org/loop?org=${org}`).then((r) => r.json());

let runId = null;
try {
  const started = await post({ action: "start", org, repos: [repo], concurrency: 1, maxCycles: 1 });
  if (started.error) throw new Error("start refused: " + started.error);
  runId = started.run.id;
  console.log(`STARTED ${runId} phase=${started.run.phase}`);

  for (let i = 1; i <= probes; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const j = await get();
    const row = (j.runs ?? []).find((r) => r.id === runId);
    console.log(
      `probe ${i}: GET /api/org/loop -> phase=${row?.phase} error=${JSON.stringify(row?.error ?? null)} active=${j.active?.id === runId ? "this run" : String(j.active?.id ?? null)}`,
    );
    if (row?.phase === "stopped" || row?.phase === "done" || row?.phase === "error") {
      console.log("RUN LEFT `running` AFTER A READ — settled as:", row.phase, "|", row.error ?? "(no error)");
      break;
    }
  }
} catch (e) {
  console.log("ERROR:", String(e).split("\n")[0]);
} finally {
  if (runId) {
    const stopped = await post({ action: "stop", org, id: runId }).catch((e) => ({ error: String(e) }));
    console.log("CLEANUP stop ->", JSON.stringify(stopped.run?.phase ?? stopped.error ?? stopped));
    const final = await get().catch(() => null);
    const row = (final?.runs ?? []).find((r) => r.id === runId);
    console.log("FINAL:", runId, "phase =", row?.phase, "| active =", String(final?.active?.id ?? null));
  }
}
