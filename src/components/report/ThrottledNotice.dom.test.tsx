// @vitest-environment jsdom
//
// The throttled notice: a countdown to the limiter's honest retry-after, a "Resume now" that stays
// disabled until the window drains, ONE automatic resume after the jittered wait, none from a hidden
// tab or after the per-visit cap. The re-scan alert shows the same countdown instead of Retry.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThrottledNotice } from "./ThrottledNotice";
import { RescanAlert } from "./ReportRescanAlert";
import type { Throttle } from "./scanThrottleModel";

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const half = () => 0.5; // jitter = 1000ms
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const throttle = (scope: Throttle["scope"] = "global"): Throttle => ({ scope, retryAt: NOW + 5000 });
const resumeBtn = () => screen.getByRole("button", { name: /resume now/i });
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("ThrottledNotice", () => {
  it("counts down, keeps Resume now disabled until retryAt, then resumes exactly once after the jitter", () => {
    const onResume = vi.fn();
    render(<ThrottledNotice throttle={throttle()} autoUsed={0} onResume={onResume} rng={half} />);
    expect(resumeBtn()).toBeDisabled();
    expect(document.body.textContent).toMatch(/5s/);

    advance(4900);
    expect(resumeBtn()).toBeDisabled();
    expect(onResume).not.toHaveBeenCalled();

    advance(200); // past retryAt, inside the jitter
    expect(resumeBtn()).not.toBeDisabled();
    expect(onResume).not.toHaveBeenCalled();

    advance(1000); // retryAt + 1000ms jitter
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledWith(true);
    advance(10_000);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("global scope says the shared budget is busy and it is not the visitor's traffic", () => {
    render(<ThrottledNotice throttle={throttle("global")} autoUsed={0} onResume={vi.fn()} rng={half} />);
    expect(document.body.textContent).toMatch(/shared scan budget is busy/i);
    expect(document.body.textContent).toMatch(/not your traffic/i);
    expect(document.body.textContent).not.toContain("—");
  });

  it("after the per-visit cap it never auto-resumes; Resume now resumes by hand", () => {
    const onResume = vi.fn();
    render(<ThrottledNotice throttle={throttle("ip")} autoUsed={2} onResume={onResume} rng={half} />);
    advance(20_000);
    expect(onResume).not.toHaveBeenCalled();
    fireEvent.click(resumeBtn());
    expect(onResume).toHaveBeenCalledWith(false);
    expect(document.body.textContent).not.toContain("—");
  });

  it("a hidden tab never auto-resumes; becoming visible after retryAt resumes", () => {
    visibility = "hidden";
    const onResume = vi.fn();
    render(<ThrottledNotice throttle={throttle()} autoUsed={0} onResume={onResume} rng={half} />);
    advance(20_000);
    expect(onResume).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/paused while this tab is in the background/i);

    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});

describe("RescanAlert - a throttled re-test", () => {
  it("shows the countdown instead of Retry, and the auto-resume re-runs the re-test", () => {
    const onRetry = vi.fn();
    render(
      <RescanAlert
        repo="acme/app"
        error="Scanning is paused for a moment by the rate limit."
        errorClass={{ throttled: throttle() }}
        autoResumes={0}
        signInNext="/report?repo=acme%2Fapp"
        onRetry={onRetry}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /^retry$/i })).toBeNull();
    expect(resumeBtn()).toBeDisabled();
    expect(document.body.textContent).toContain("Your existing report is unchanged.");
    advance(7100); // retry-after + the widest jitter (no rng injected here)
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(true);
  });
});
