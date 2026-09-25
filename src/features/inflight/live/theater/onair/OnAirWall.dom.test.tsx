// @vitest-environment jsdom
//
// The On Air wall rendered whole from the fixture: the four answers are the classic header's model,
// the program monitor carries the lane at work, stale switches every liveness claim together and
// freezes the clock, the kiosk renders no link, nothing-to-report hands over to TheaterEmpty, and a
// landing slate appears only from a celebrate cue.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LoopPulse } from "@/lib/local/runner-types";
import type { TheaterSource } from "../TheaterShell";
import type { TheaterCue } from "../theaterCues";
import { DEMO_EPOCH, fixturePulse, fixturePulseAt, type DemoScenario } from "../theaterFixture";
import { fmtHms } from "./onairFormat";
import { OnAirWall } from "./OnAirWall";

const T = DEMO_EPOCH + 320_000; // kp reading, systedo editing, one plan waiting
const feedAt = (pulse: LoopPulse | null, receivedAt: number, now = receivedAt) => ({
  pulse,
  loaded: true,
  receivedAt,
  listeningSince: receivedAt,
  now,
  error: null,
  arrivedKeys: new Set<string>(),
});
const demo = (scenario: DemoScenario = "running"): TheaterSource => ({ kind: "demo", slug: "kiro", scenario, startAtS: 0 });

function wall(pulse: LoopPulse | null, opts: { source?: TheaterSource; now?: number; cards?: TheaterCue[] } = {}) {
  const receivedAt = pulse ? Date.parse(pulse.at) : T;
  return render(
    <OnAirWall
      feed={feedAt(pulse, receivedAt, opts.now ?? receivedAt)}
      source={opts.source ?? demo()}
      sound="off"
      onToggleSound={() => {}}
      cards={opts.cards ?? []}
      reducedMotion={false}
    />,
  );
}
const region = (name: string) => screen.getByRole("region", { name });

describe("OnAirWall", () => {
  it("running: the four answers, the program on a lane at work, previews, wire, smalls and the label", () => {
    const { container } = wall(fixturePulseAt(T));
    expect(region("Running?")).toHaveTextContent("Running");
    expect(region("Now")).toHaveTextContent(/·/);
    expect(region("Today")).toHaveTextContent(/verified/);
    expect(screen.getByLabelText("Needs you")).toHaveTextContent("1 plan waits");
    expect(screen.getByLabelText("Needs you")).toHaveTextContent("web: a plan splits the api module");
    expect(screen.getByTestId("onair-clock")).toHaveTextContent(fmtHms(T)!);
    expect(container.querySelector('[data-role="onair-onair"]')).toHaveAttribute("data-state", "on");
    const mons = container.querySelectorAll('[data-role="onair-mon"]');
    expect(mons).toHaveLength(5);
    const pgm = container.querySelector('[data-kind="pgm"]')!;
    expect(pgm.getAttribute("aria-label")).toMatch(/^PGM: acme\/(kp|systedo)$/);
    expect(pgm.querySelectorAll('[data-role^="onair-tile"]').length).toBeGreaterThan(0);
    expect(pgm.querySelectorAll('[data-role="onair-stage-on"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-role="onair-wire-row"]').length).toBeGreaterThan(0);
    expect(within(container.querySelector('[data-role="onair-small"]') as HTMLElement).getByText("web")).toBeInTheDocument();
    expect(container.querySelector('[data-role="onair-label"]')).toHaveTextContent("demo · fixture data");
    expect(container.querySelector("[data-stale]")).toBeNull();
  });

  it("links: the desk and the CALL (to the ledger inbox) on a signed-in wall", () => {
    wall(fixturePulseAt(T), { source: { kind: "org", slug: "kiro" } });
    expect(screen.getByRole("link", { name: /Desk/ })).toHaveAttribute("href", "/org/kiro?tab=live&view=desk");
    expect(screen.getByRole("link", { name: "Needs you" })).toHaveAttribute("href", "/org/kiro?tab=live&view=ledger");
  });

  it("kiosk: no link anywhere", () => {
    const { container } = wall(fixturePulseAt(T), { source: { kind: "kiosk", slug: "kiro", token: "t" } });
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelector('[data-role="onair-label"]')).toHaveTextContent("kiosk · read-only");
  });

  it("stale: every liveness claim switches together and the clock freezes at last contact", () => {
    const pulse = fixturePulseAt(T);
    const { container, rerender } = wall(pulse, { now: T + 15_000 });
    expect(container.querySelector("[data-stale]")).not.toBeNull();
    expect(container.querySelector('[data-role="onair-onair"]')).toHaveTextContent("NO SIGNAL");
    expect(region("Running?")).toHaveTextContent("Reconnecting…");
    expect(region("Now")).toHaveTextContent("Last heard 15 s ago");
    expect(region("Today")).toHaveTextContent("as of 15 s ago");
    expect(screen.getByTestId("onair-clock")).toHaveTextContent(fmtHms(T)!);
    expect(container.querySelector('[data-kind="pgm"]')).toHaveTextContent(`Last heard 15 s ago · frame as of ${fmtHms(T)}`);
    expect(container.querySelector('[data-role="onair-small"]')).toHaveTextContent("last heard 15 s ago");
    // Nothing moves: five more seconds change only the "last heard" words, never a lane's figures.
    const l3 = container.querySelector('[data-kind="pgm"] [data-role="onair-l3"]')!.textContent;
    rerender(<OnAirWall feed={feedAt(pulse, T, T + 20_000)} source={demo()} sound="off" onToggleSound={() => {}} cards={[]} reducedMotion={false} />);
    expect(container.querySelector('[data-kind="pgm"] [data-role="onair-l3"]')!.textContent).toBe(l3);
    expect(screen.getByTestId("onair-clock")).toHaveTextContent(fmtHms(T)!);
  });

  it("paused on spend: every slot says HELD and why, and the CALL is up", () => {
    const { container } = wall(fixturePulseAt(T, "paused-spend"), { source: demo("paused-spend") });
    const pgm = container.querySelector('[data-kind="pgm"]')!;
    expect(pgm).toHaveAttribute("data-blank");
    expect(pgm).toHaveTextContent("HELD");
    expect(pgm).toHaveTextContent("Runner paused · spend ceiling");
    expect(screen.getByLabelText("Needs you")).toHaveAttribute("data-call");
    expect(container.querySelector('[data-role="onair-onair"]')).toHaveTextContent("OFF AIR");
  });

  it("nothing to report: TheaterEmpty says it once and the monitors stand down", () => {
    const empty = fixturePulse({ runner: null, run: null, lanes: [], latest: [], today: { verifiedCloses: 0, landed: 0, liftPoints: null, spendMicros: 0 } });
    const { container } = wall(empty, { source: { kind: "org", slug: "kiro" } });
    expect(container.querySelector("[data-theater-empty]")).not.toBeNull();
    expect(container.querySelectorAll('[data-role="onair-mon"]')).toHaveLength(0);
  });

  it("a celebrate cue puts the landing slate on the landed lane's own monitor; an attention cue does not", () => {
    const pulse = fixturePulseAt(DEMO_EPOCH + 170_000);
    const landed = pulse.latest.find((e) => e.kind === "landed" && e.repo === "acme/kp")!;
    const cue = (kind: TheaterCue["kind"]): TheaterCue[] => [{ id: "cue-1", kind, headline: landed.headline, detail: null, events: [landed] }];
    const { container, unmount } = wall(pulse, { cards: cue("celebrate") });
    const kp = container.querySelector('[aria-label$="acme/kp"]')!;
    expect(within(kp as HTMLElement).getByRole("status")).toHaveTextContent(/LANDED.*kp landed run #14.*verified close · D4 · cited claims/);
    unmount();
    wall(pulse, { cards: cue("attention") });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
