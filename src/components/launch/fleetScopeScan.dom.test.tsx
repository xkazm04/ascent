// @vitest-environment jsdom
//
// The scoped fleet scan: a plan of per-org scoped POSTs, run one org at a time under the map's one-scan
// lock, cancellable between orgs, stopped by a refusal. A double click starts one plan.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { ScopeScan } from "./FleetMap.ScopeScan";
import { useFleetScan } from "./useFleetScan";
import type { Constellation } from "./fleetMapStars";
import type { ScopePlan } from "./fleetScopeModel";

const enc = new TextEncoder();
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

type Live = { close: () => void; push: (s: string) => void };
let posts: { body: unknown }[];
let bodies: Live[];
let refuse: { status: number; error: string } | null;

beforeEach(() => {
  posts = [];
  bodies = [];
  refuse = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url !== "/api/org/scan") return Response.json({ repos: [], pending: 0 });
    posts.push({ body: JSON.parse(String(init?.body)) });
    if (refuse) {
      const r = refuse;
      return { ok: false, status: r.status, body: null, json: async () => ({ error: r.error }) };
    }
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (c) => { ctl = c; } });
    bodies.push({ close: () => ctl.close(), push: (s) => ctl.enqueue(enc.encode(s)) });
    return { ok: true, status: 200, body, json: async () => null };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const installations = [{ id: 1, login: "A" }, { id: 2, login: "B" }];
const plan: ScopePlan = { runs: [{ org: "A", repos: ["a1"] }, { org: "B", repos: ["b1"] }], scanCount: 2, excludedUnwatched: 1 };
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
function mount() {
  const setConstellations = vi.fn((u: Constellation[] | ((c: Constellation[]) => Constellation[])) => {
    if (typeof u === "function") u([]);
  });
  return renderHook(() => useFleetScan(installations, setConstellations));
}
async function finish(i: number) {
  bodies[i]!.push(frame("repo", { repo: i === 0 ? "a1" : "b1", overall: 70 }));
  bodies[i]!.close();
  await flush();
}

describe("useFleetScan.runPlan", () => {
  it("posts one scoped run at a time, in order, and locks the per-org Scan while the plan runs", async () => {
    const { result } = mount();
    let done: Promise<void> = Promise.resolve();
    act(() => { done = result.current.runPlan(plan); });
    await flush();
    expect(posts).toEqual([{ body: { org: "A", repos: ["a1"] } }]);
    expect(result.current.planActive).toBe(true);
    expect(result.current.scanDisabledFor("A")).toBe(true);
    expect(result.current.scanDisabledFor("B")).toBe(true);
    // A per-org click mid-plan is a no-op, not a second stream.
    await act(async () => { await result.current.scan("B"); });
    expect(posts).toHaveLength(1);

    await finish(0);
    expect(posts).toEqual([{ body: { org: "A", repos: ["a1"] } }, { body: { org: "B", repos: ["b1"] } }]);
    expect(result.current.scanDisabledFor("A")).toBe(true);
    await finish(1);
    await act(async () => { await done; });
    expect(result.current.planActive).toBe(false);
    expect(result.current.scanDisabledFor("A")).toBe(false);
  });

  it("Cancel during the first run: it settles, and the second POST is never sent", async () => {
    const { result } = mount();
    let done: Promise<void> = Promise.resolve();
    act(() => { done = result.current.runPlan(plan); });
    await flush();
    act(() => { result.current.cancelPlan(); });
    expect(result.current.planCancelling).toBe(true);
    await finish(0);
    await act(async () => { await done; });
    expect(posts).toHaveLength(1);
    expect(result.current.planActive).toBe(false);
  });

  it("a 402 on the first run stops the plan: org A shows the refusal, org B is not scanned", async () => {
    refuse = { status: 402, error: "Out of scan credits." };
    const { result } = mount();
    await act(async () => { await result.current.runPlan(plan); });
    expect(posts).toHaveLength(1);
    expect(result.current.outcomes.A?.kind).toBe("credits");
    expect(result.current.outcomes.A?.message).toBe("Out of scan credits.");
    expect(result.current.outcomes.B).toBeUndefined();
  });

  it("never posts an empty scope (the server would widen it to the whole watchlist)", async () => {
    const { result } = mount();
    await act(async () => { await result.current.runPlan({ runs: [{ org: "A", repos: [] }], scanCount: 0, excludedUnwatched: 0 }); });
    expect(posts).toHaveLength(0);
  });
});

function Harness({ p }: { p: ScopePlan }) {
  const fs = useFleetScan(installations, () => {});
  return <ScopeScan plan={p} active={fs.planActive} cancelling={fs.planCancelling} onRun={() => void fs.runPlan(p)} onCancel={fs.cancelPlan} />;
}

describe("ScopeScan", () => {
  it("previews the label and the draw, and a double click starts one plan", async () => {
    render(<Harness p={plan} />);
    const btn = screen.getByRole("button", { name: /Scan 2 matching watched repos \(2 orgs\)/ });
    expect(btn.textContent).toBe("Scan 2 matching watched repos (2 orgs) · 1 unwatched not scanned");
    expect(screen.getByText("Draws up to 2 scan credits, one per repo, one org at a time.")).toBeTruthy();
    fireEvent.click(btn);
    fireEvent.click(btn);
    await flush();
    expect(posts).toHaveLength(1);
    expect(screen.getByRole("button", { name: /stop after this org/i })).toBeTruthy();
    expect(document.body.textContent).not.toContain("\u2014");
  });

  it("renders disabled-with-reason when every match is unwatched, and never POSTs", async () => {
    const none: ScopePlan = { runs: [], scanCount: 0, excludedUnwatched: 3, reason: "none-watched" };
    render(<Harness p={none} />);
    const btn = screen.getByRole("button", { name: /No watched repo matches/ });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.getAttribute("title")).toMatch(/watch/i);
    fireEvent.click(btn);
    await flush();
    expect(posts).toHaveLength(0);
  });

  it("renders nothing without a plan", () => {
    const { container } = render(<ScopeScan plan={null} active={false} cancelling={false} onRun={() => {}} onCancel={() => {}} />);
    expect(container.textContent).toBe("");
  });
});
