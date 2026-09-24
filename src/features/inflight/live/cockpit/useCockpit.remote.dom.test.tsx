// @vitest-environment jsdom
//
// THE REMOTE-AGENT ARM, THROUGH THE REAL COMPOSITION (backlog develop-2026-09-17 row 29): `useCockpit`
// feeding `CockpitRail` exactly as LiveCockpit wires it, over a fetch stub standing in for a managed
// cloud deployment with no hosted worker. A hosted owner presses the card's arm; the POST carries the
// remote-agent body and nothing else, the rail follows the run it armed, and no drive is ever asked for.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { CockpitRail } from "./CockpitRail";
import { useCockpit } from "./useCockpit";
import type { LoopRunRecord, LoopRunSummary } from "./loopTypes";

const remoteRun = (): LoopRunRecord =>
  ({ id: "run-r", orgId: "o", createdBy: "kaz", phase: "curating", repos: ["acme/a"], concurrency: 1, maxCycles: 1, cycle: 0,
    curated: false, startedAt: "2026-09-24T10:00:00Z", endedAt: null, error: null, createdAt: "2026-09-24T10:00:00Z" }) as LoopRunRecord;

let armed = false;
let calls: { url: string; init?: RequestInit }[] = [];

beforeEach(() => {
  armed = false;
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "POST") armed = true;
      const body =
        init?.method === "POST"
          ? { run: remoteRun() }
          : url.startsWith("/api/org/loop?")
            ? { enabled: false, active: armed ? remoteRun() : null, runs: [], hosted: { enabled: false, reason: "No worker.", available: false } }
            : url.startsWith("/api/org/loop/run-r")
              ? { run: remoteRun(), lanes: [], outcomes: [], itemOutcomes: [] }
              : { proposals: [] };
      return { ok: true, json: async () => body } as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function Harness({ isOwner }: { isOwner: boolean }) {
  const c = useCockpit({
    slug: "acme",
    seeds: [{ fullName: "acme/a", name: "a", overall: 60, adoption: 60, rigor: 60, level: "L3", posture: null }],
    histories: [],
    pairedRepos: [],
    activeRun: null,
    // The last run's repos seed the selection, exactly as on a real page.
    runs: [{ repos: ["acme/a"] } as LoopRunSummary],
    loopEnabled: false,
    selfHosted: false,
    isOwner,
  });
  const noop = () => undefined;
  return (
    <CockpitRail
      slug="acme" mode={c.mode === "outcome" ? "inspect" : c.mode} setup={c.setup} setupMessage={c.setupMessage}
      liveDrive={c.drive.live ? c.drive.drive : null} interruptedDrive={c.interruptedDrive} runDetail={c.loop.detail}
      runLive={c.loop.live} batch={c.batch} dials={c.dials} canRun={c.canRun} busy={false} loopError={c.loop.error}
      driveError={null} onRun={noop} onDrive={noop} onStopRun={noop} onStopDrive={noop} onResumeDrive={noop}
      onDismissDrive={noop} onRetryLane={noop} remoteArm={c.remoteArm}
    />
  );
}

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

describe("useCockpit — a hosted owner arms a remote-agent run from the setup card", () => {
  it("posts the remote-agent body for the selection and follows the run it armed", async () => {
    render(<Harness isOwner />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Arm remote run (1 repo)" }));
    await settle();
    await settle();
    const posts = calls.filter((c) => c.init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0].init?.body))).toEqual({ org: "acme", action: "start", repos: ["acme/a"], executor: "remote-agent" });
    // The rail now shows the run, not the card that armed it.
    expect(screen.queryByRole("button", { name: /Arm remote run/ })).toBeNull();
    // The drive stays local-only: a hosted cockpit never even reads the drive route.
    expect(calls.some((c) => c.url.startsWith("/api/org/local/drive"))).toBe(false);
  });

  it("guard: a member on the same deployment gets the card and no arm", async () => {
    render(<Harness isOwner={false} />);
    await settle();
    expect(screen.getByText(/Remote-agent runs do work here/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Arm remote run/ })).toBeNull();
  });
});
