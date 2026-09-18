// @vitest-environment jsdom
//
// The runner notifier's contract: NOTHING for a user who never asked (no prompt, no poll — at most one
// probe so the offer only appears where a runner exists), a permission request only inside a click,
// and once armed: a poll every NOTIFIER_POLL_MS that is NOT visibility-gated, dedup per item (persisted),
// and at most one OS notification per NOTIFY_BATCH_MS summarising only what is new.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFIER_POLL_MS, NOTIFY_BATCH_MS } from "@/lib/local/runner-types";
import { RunnerNotifier } from "./RunnerNotifier";

type Perm = "default" | "granted" | "denied";
const shown: { title: string; body: string }[] = [];
class FakeNotification {
  static permission: Perm = "default";
  static requestPermission = vi.fn(async () => {
    FakeNotification.permission = "granted";
    return "granted" as Perm;
  });
  onclick: (() => void) | null = null;
  constructor(title: string, opts: { body: string }) {
    shown.push({ title, body: opts.body });
  }
  close() {}
}

let answer: Record<string, unknown> = {};
let calls = 0;
const plan = (id: string) => ({ id, repo: "acme/web", title: `plan ${id}`, createdAt: "2026-09-18T10:00:00Z" });

function install(permission: Perm | "unsupported") {
  if (permission === "unsupported") delete (window as { Notification?: unknown }).Notification;
  else {
    FakeNotification.permission = permission;
    Object.defineProperty(window, "Notification", { value: FakeNotification, configurable: true, writable: true });
  }
}
const arm = () => window.localStorage.setItem("ascent-runner-notify:acme", "1");
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
  window.localStorage.clear();
  shown.length = 0;
  calls = 0;
  FakeNotification.requestPermission.mockClear();
  answer = { runner: true, plans: [], pausedRepos: [], runnerPaused: null };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => answer } as Response;
    }),
  );
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as { Notification?: unknown }).Notification;
});

describe("RunnerNotifier — before anyone asked", () => {
  it("no Notification API or a denied permission: not a single request", async () => {
    install("unsupported");
    const a = render(<RunnerNotifier slug="acme" />);
    await advance(NOTIFIER_POLL_MS * 5);
    a.unmount();
    install("denied");
    render(<RunnerNotifier slug="acme" />);
    await advance(NOTIFIER_POLL_MS * 5);
    expect(calls).toBe(0);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it("never enabled: one probe at most, never a poll, never a prompt — the offer shows for a runner org", async () => {
    install("default");
    render(<RunnerNotifier slug="acme" />);
    await advance(NOTIFIER_POLL_MS * 10);
    expect(calls).toBe(1);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Notify me when the runner needs me" })).toBeInTheDocument();
  });

  it("an org with no runner and nothing waiting is not offered anything", async () => {
    install("default");
    answer = { runner: false, plans: [], pausedRepos: [], runnerPaused: null };
    const { container } = render(<RunnerNotifier slug="acme" />);
    await advance(NOTIFIER_POLL_MS * 3);
    expect(calls).toBe(1);
    expect(container.innerHTML).toBe("");
  });

  it("the permission prompt happens only inside the click, and arms the poll", async () => {
    install("default");
    render(<RunnerNotifier slug="acme" />);
    await advance(0);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Notify me when the runner needs me" })));
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    await advance(0);
    await advance(NOTIFIER_POLL_MS * 2);
    expect(calls).toBeGreaterThanOrEqual(3); // the probe, then the armed chain
    expect(screen.queryByRole("button", { name: /Notify me/ })).toBeNull();
  });

  it("dismissing the offer is remembered", async () => {
    install("default");
    const a = render(<RunnerNotifier slug="acme" />);
    await advance(0);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss the notification offer" }));
    expect(screen.queryByRole("button", { name: /Notify me/ })).toBeNull();
    a.unmount();
    calls = 0;
    render(<RunnerNotifier slug="acme" />);
    await advance(NOTIFIER_POLL_MS);
    expect(calls).toBe(0);
  });
});

describe("RunnerNotifier — armed", () => {
  it("polls every NOTIFIER_POLL_MS even while the tab is hidden", async () => {
    install("granted");
    arm();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    render(<RunnerNotifier slug="acme" />);
    await advance(0);
    expect(calls).toBe(1);
    await advance(NOTIFIER_POLL_MS * 3);
    expect(calls).toBe(4);
  });

  it("dedups per item: one notification for what waits, none on the next polls, none after a reload", async () => {
    install("granted");
    arm();
    answer = { runner: true, plans: [plan("1"), plan("2")], pausedRepos: [{ repo: "acme/kp", reason: "branch-conflict", note: null }], runnerPaused: null };
    const a = render(<RunnerNotifier slug="acme" />);
    await advance(0);
    expect(shown).toEqual([{ title: "Ascent — the runner needs you", body: "2 directions wait for your approval · kp paused: branch conflict" }]);
    await advance(NOTIFY_BATCH_MS * 2);
    expect(shown).toHaveLength(1);
    a.unmount();
    render(<RunnerNotifier slug="acme" />);
    await advance(NOTIFIER_POLL_MS);
    expect(shown).toHaveLength(1);
  });

  it("batches: something new inside the window waits, then ONE notification names only what is new", async () => {
    install("granted");
    arm();
    answer = { runner: true, plans: [plan("1")], pausedRepos: [], runnerPaused: null };
    render(<RunnerNotifier slug="acme" />);
    await advance(0);
    expect(shown).toHaveLength(1);
    answer = { runner: true, plans: [plan("1"), plan("2")], pausedRepos: [], runnerPaused: { reason: "spend-ceiling", until: null } };
    await advance(NOTIFIER_POLL_MS * 5);
    expect(shown).toHaveLength(1);
    await advance(NOTIFY_BATCH_MS);
    expect(shown).toHaveLength(2);
    expect(shown[1]!.body).toBe("1 direction waits for your approval · Runner paused: spend ceiling");
  });

  it("turning the preference off stops the poll", async () => {
    install("granted");
    arm();
    render(<RunnerNotifier slug="acme" />);
    await advance(0);
    const { setRunnerNotifyWanted } = await import("@/lib/org/runner-notify");
    await act(async () => setRunnerNotifyWanted("acme", false));
    const before = calls;
    await advance(NOTIFIER_POLL_MS * 3);
    expect(calls).toBe(before + 1); // the probe of the now-unarmed offer path, and nothing after
  });
});
