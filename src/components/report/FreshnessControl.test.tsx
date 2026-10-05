// @vitest-environment jsdom
//
// A wired-component DOM test for the destructive-action gate (bug-ui-scan-2026-07-09 theme T13). Unit
// tests pin the confirm COPY; this pins the WIRING — that clicking "Re-test" no longer spends a weekly
// scan slot on the spot. FreshnessControl is the cleanest site to prove it against: `onRetest` is a
// plain callback (no fetch to mock), so a spy that stays uncalled until the confirm IS the proof that
// the quota-spending action doesn't fire on the first click.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ScanReport } from "@/lib/types";
import { FreshnessControl } from "./FreshnessControl";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// FreshnessControl reads only scannedAt + repo.{owner,name,headSha}; the rest of ScanReport is irrelevant.
const report = {
  scannedAt: new Date().toISOString(),
  repo: { owner: "acme", name: "web", headSha: undefined },
} as unknown as ScanReport;

describe("FreshnessControl Re-test — the scan slot isn't spent until confirmed", () => {
  it("opens a scope-stating confirm on the first click and does NOT re-scan yet", () => {
    const onRetest = vi.fn();
    render(<FreshnessControl report={report} onRetest={onRetest} />);

    // No dialog before the click, and the metered action has not run.
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Re-test" }));

    // The dialog is up and names the repo — but onRetest (the quota spend) has NOT fired.
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/Re-scan acme\/web\?/)).toBeInTheDocument();
    expect(onRetest).not.toHaveBeenCalled();
  });

  it("fires the re-scan only after the explicit Confirm", () => {
    const onRetest = vi.fn();
    render(<FreshnessControl report={report} onRetest={onRetest} />);

    fireEvent.click(screen.getByRole("button", { name: "Re-test" }));
    expect(onRetest).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Re-scan now" }));
    expect(onRetest).toHaveBeenCalledTimes(1);
  });

  it("Cancel backs out without ever spending a slot", () => {
    const onRetest = vi.fn();
    render(<FreshnessControl report={report} onRetest={onRetest} />);

    fireEvent.click(screen.getByRole("button", { name: "Re-test" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onRetest).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("FreshnessControl Re-test — permalink stays on the durable path", () => {
  it("links to /report/{owner}/{repo}?fresh=1, not /report?repo=", () => {
    render(<FreshnessControl report={report} />);

    const link = screen.getByRole("link", { name: "Re-test" });
    expect(link).toHaveAttribute("href", "/report/acme/web?fresh=1");
    expect(link.getAttribute("href")).not.toMatch(/[?&]repo=/);
  });

  it("keeps a pinned commit on the durable path (fresh query only)", () => {
    const pinned = {
      scannedAt: report.scannedAt,
      repo: { owner: "acme", name: "web", headSha: "abc123def" },
    } as unknown as ScanReport;
    render(<FreshnessControl report={pinned} />);

    const link = screen.getByRole("link", { name: "Re-test" });
    expect(link).toHaveAttribute("href", "/report/acme/web@abc123def?fresh=1");
    expect(link.getAttribute("href")).not.toMatch(/[?&]repo=/);
  });
});

// ---------------------------------------------------------------------------------------------
// Freshness as a STATE with a reason (challenge card 5). The control is the surface that publishes
// the report's claim, so every tier must render and none may wear the fresh costume.

const WEEK = 7 * 86_400_000;

/** A report scanned `ms` ago, scored at `scoredSha`. */
function aged(ms: number, scoredSha?: string): ScanReport {
  return {
    scannedAt: new Date(Date.now() - ms).toISOString(),
    repo: { owner: "acme", name: "web", headSha: scoredSha },
  } as unknown as ScanReport;
}

describe("FreshnessControl — a current reading renders today's muted line and nothing else", () => {
  it("shows only Scanned 10m ago, with no reason and no drift clause", () => {
    render(
      <FreshnessControl report={aged(10 * 60_000, "abc1234")} lastSeenHead="abc1234" freshnessWindowMs={WEEK} />,
    );
    expect(screen.getByText("10m ago")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Scanned");
    expect(text).not.toMatch(/last seen head/i);
    expect(text).not.toMatch(/re-scans on/i);
    expect(screen.getByRole("link", { name: "Re-test" })).toBeInTheDocument();
  });

  it("renders the same single line when no freshness props are threaded at all (live-scan path)", () => {
    render(<FreshnessControl report={aged(10 * 60_000, "abc1234")} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/re-scans on/i);
    expect(text).not.toMatch(/last seen head/i);
    expect(screen.getByRole("link", { name: "Re-test" })).toBeInTheDocument();
  });
});

describe("FreshnessControl — a stale reading states its age in a non-muted tone, with the reason", () => {
  it("states the reason and names the window the product re-scans on", () => {
    render(<FreshnessControl report={aged(30 * 86_400_000, "abc1234")} lastSeenHead="abc1234" freshnessWindowMs={WEEK} />);
    const reason = screen.getByTestId("freshness-reason");
    expect(reason).toHaveTextContent(/7-day window/i);
    expect(reason).toHaveTextContent(/re-scans on/i);
    expect(reason.textContent ?? "").not.toContain("—");
  });

  it("drops the muted tone on the age itself", () => {
    render(<FreshnessControl report={aged(30 * 86_400_000, "abc1234")} lastSeenHead="abc1234" freshnessWindowMs={WEEK} />);
    const age = screen.getByTestId("freshness-age");
    expect(age.className).not.toContain("text-slate-300");
    expect(age.className).toMatch(/text-amber/);
  });
});

describe("FreshnessControl — drift is stated as LAST SEEN, never as current", () => {
  it("renders scored abc1234, last seen head def5678", () => {
    render(<FreshnessControl report={aged(60_000, "abc1234")} lastSeenHead="def5678" freshnessWindowMs={WEEK} />);
    const drift = screen.getByTestId("freshness-drift");
    expect(drift).toHaveTextContent("scored abc1234");
    expect(drift).toHaveTextContent("last seen head def5678");
    expect(drift.textContent ?? "").not.toMatch(/current head/i);
  });

  it("renders no drift clause when the head hint was never recorded", () => {
    render(<FreshnessControl report={aged(60_000, "abc1234")} lastSeenHead={null} freshnessWindowMs={WEEK} />);
    expect(screen.queryByTestId("freshness-drift")).toBeNull();
  });
});

describe("FreshnessControl — an unreadable scan date reads as unknown, not as fresh", () => {
  it("states that no scan date was recorded", () => {
    const report = { scannedAt: undefined, repo: { owner: "acme", name: "web" } } as unknown as ScanReport;
    render(<FreshnessControl report={report} freshnessWindowMs={WEEK} />);
    expect(screen.getByTestId("freshness-reason")).toHaveTextContent(/no recorded scan date/i);
  });
});

describe("FreshnessControl — the one action stays one action", () => {
  it("promotes the existing Re-test control and names what it would do, adding no second button", () => {
    const onRetest = vi.fn();
    render(
      <FreshnessControl
        report={aged(30 * 86_400_000, "abc1234")}
        lastSeenHead="def5678"
        freshnessWindowMs={WEEK}
        onRetest={onRetest}
      />,
    );
    const retest = screen.getByRole("button", { name: /refresh this reading/i });
    expect(retest.className).toContain("text-accent");
    // Exactly one affordance in the control itself (the confirm dialog's own buttons are mounted
    // closed and carry their own names).
    expect(screen.getAllByRole("button", { name: /re-test/i })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^scan /i })).toBeNull();
  });

  it("leaves the plain Re-test label on a current reading", () => {
    render(<FreshnessControl report={aged(60_000, "abc1234")} lastSeenHead="abc1234" freshnessWindowMs={WEEK} onRetest={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Re-test" })).toBeInTheDocument();
  });
});
