// @vitest-environment jsdom
//
// STARTING THE STANDING RUNNER, end to end through the real composition (spark theater-upgrade,
// 2026-09-18): `useCockpit` (useLoopRun + useDrive + the dials) feeding `CockpitSetupDialog` exactly as
// LiveCockpit wires it, over a fetch stub. The operator switches the dialog to "Standing runner",
// types a ceiling and presses Start; what is pinned is the BODY the drive route receives — continuous,
// the ceiling in USD, the dials with verify forced on, the agent config, and NO delivery, rope or
// repos (the default scope is the server's) — and that the dialog closes only on an accepted start.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { CockpitSetupDialog } from "./CockpitSetupDialog";
import { runnerDrive } from "./runner.fixture";
import { useCockpit } from "./useCockpit";

let posts: Record<string, unknown>[] = [];
let refuse: string | null = null;

beforeEach(() => {
  posts = [];
  refuse = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        if (refuse) return { ok: false, status: 400, json: async () => ({ error: refuse }) } as Response;
        return { ok: true, status: 202, json: async () => ({ drive: runnerDrive() }) } as Response;
      }
      const body = url.startsWith("/api/org/local/drive")
        ? { enabled: true, drives: [] }
        : url.startsWith("/api/org/loop?")
          ? { enabled: true, active: null, runs: [] }
          : { proposals: [] };
      return { ok: true, json: async () => body } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({ onClose }: { onClose: () => void }) {
  const c = useCockpit({
    slug: "acme",
    seeds: [{ fullName: "acme/a", name: "a", overall: 60, adoption: 60, rigor: 60, level: "L3", posture: null }],
    histories: [],
    pairedRepos: ["acme/a"],
    activeRun: null,
    runs: [],
    loopEnabled: true,
    selfHosted: true,
    isOwner: true,
  });
  return <CockpitSetupDialog c={c} open onClose={onClose} runnerRepos={["acme/a"]} />;
}

async function armRunner(ceiling: string) {
  await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
  fireEvent.click(within(screen.getByTestId("setup-mode")).getByRole("radio", { name: "Standing runner" }));
  fireEvent.change(screen.getByTestId("setup-spend-ceiling"), { target: { value: ceiling } });
  await act(async () => {
    fireEvent.click(screen.getByTestId("setup-start-runner"));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("CockpitSetupDialog — starting the standing runner", () => {
  it("sends a continuous drive with the ceiling, the dials and verify forced on — and closes", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await armRunner("40");

    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({
      org: "acme",
      action: "start",
      mode: "continuous",
      maxCycles: 3,
      concurrency: 2,
      model: null,
      effort: null,
      spendCeilingUsd: 40,
      // Since 2026-09-21 the runner carries the ARMS the builder composed, like the other two starts.
      // The untouched dialog composes one Claude arm on the deployment default — the pre-arms runner,
      // written down — so an operator who never opens the Arms panel arms what they armed yesterday.
      // Since challenge-2026-09-23b they ride INSIDE the dials, the only place the drive route reads.
      dials: {
        batchSize: 5,
        agentTimeoutMs: 1_200_000,
        verifyMode: "on",
        verifyTimeoutMs: 600_000,
        rescanCadence: "cycle",
        armPolicy: "single",
        arms: [{ id: "claude-sonnet-1", label: "claude:sonnet", transport: "claude", model: "sonnet", plan: null }],
      },
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open with the route's own refusal when the start is refused", async () => {
    refuse = "spendCeilingUsd can be at most 1000000 on this deployment (or null for no ceiling).";
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await armRunner("0");

    expect(posts[0]).toMatchObject({ mode: "continuous", spendCeilingUsd: 0 });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/at most 1000000/);
  });
});
