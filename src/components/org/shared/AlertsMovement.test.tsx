// @vitest-environment jsdom
//
// The unread half of the Alerts chip: the movement count on the bell, the "since you last looked"
// list, the watermark advance on open, and the degraded path. The chip renders on every org page for
// every viewer, so the degraded case (no movement payload → exactly the old chip) is as load-bearing
// as the feature itself.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AlertsControl } from "./AlertsControl";
import { movementAgo, movementBadgeLabel, movementEventLabel } from "./AlertsMovement";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const okJson = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body });

type Call = { url: string; opts?: RequestInit };

/** Serve the movement GET with `movement`, the config GET with a saved webhook, and record every call. */
function mockApi(movement: unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, opts?: RequestInit) => {
      calls.push({ url, opts });
      if (url.includes("movement=1")) return okJson({ movement });
      if (opts?.method === "POST") return okJson({ ok: true, seen: true });
      return okJson({ webhookUrl: "https://hooks.slack.com/services/T/B/xyz" });
    }),
  );
  return calls;
}

function movement(over: Record<string, unknown> = {}) {
  return {
    since: "2026-07-20T00:00:00.000Z",
    firstLook: false,
    count: 2,
    capped: false,
    items: [
      { repo: "acme/api", event: "regression", summary: "…", at: new Date(Date.now() - 3_600_000).toISOString() },
      { repo: "acme/web", event: "level-change", summary: "…", at: new Date(Date.now() - 86_400_000).toISOString() },
    ],
    ...over,
  };
}

describe("Alerts chip — movement count", () => {
  it("shows the count on the bell and lists what moved above the config section", async () => {
    mockApi(movement());
    render(<AlertsControl org="acme" />);

    const bell = await screen.findByRole("button", { name: /Alerts/ });
    await waitFor(() => expect(bell).toHaveTextContent("2"));

    fireEvent.click(bell);
    expect(await screen.findByText("Since you last looked")).toBeInTheDocument();
    expect(screen.getByText("acme/api")).toBeInTheDocument();
    expect(screen.getByText("level change")).toBeInTheDocument();
  });

  it("caps the badge at the query cap (9+) rather than counting the whole backlog", async () => {
    mockApi(movement({ count: 9, capped: true, items: [] }));
    render(<AlertsControl org="acme" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Alerts/ })).toHaveTextContent("9+"));
  });

  it("zero-state: no badge on the chip, and the section says you're up to date", async () => {
    mockApi(movement({ count: 0, items: [] }));
    render(<AlertsControl org="acme" />);
    const bell = await screen.findByRole("button", { name: /Alerts/ });
    await waitFor(() => expect(bell.textContent).toBe("🔔 Alerts"));
    fireEvent.click(bell);
    expect(await screen.findByText(/you're up to date/i)).toBeInTheDocument();
  });

  it("opening advances the watermark once and clears the badge, keeping the list on screen", async () => {
    const calls = mockApi(movement());
    render(<AlertsControl org="acme" />);
    const bell = await screen.findByRole("button", { name: /Alerts/ });
    await waitFor(() => expect(bell).toHaveTextContent("2"));

    fireEvent.click(bell);
    await waitFor(() => {
      const seen = calls.filter((c) => c.opts?.method === "POST" && String(c.opts.body).includes('"seen":true'));
      expect(seen).toHaveLength(1);
    });
    // The badge clears (they've looked) but the list they came to read stays.
    await waitFor(() => expect(bell.textContent).toBe("🔔 Alerts"));
    expect(screen.getByText("acme/api")).toBeInTheDocument();

    // Closing and reopening must not re-stamp: the watermark is advanced once per look.
    fireEvent.click(bell);
    fireEvent.click(bell);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument());
    expect(calls.filter((c) => String(c.opts?.body ?? "").includes('"seen":true'))).toHaveLength(1);
  });

  // Auth-off deployments, the public org, a viewer with no membership, and any read failure all
  // answer `{ movement: null }` — the chip must then be exactly the pre-feature chip.
  it("degrades to the old countless chip when the movement payload is null (no viewer/membership)", async () => {
    const calls = mockApi(null);
    render(<AlertsControl org="acme" />);
    const bell = await screen.findByRole("button", { name: /Alerts/ });
    await waitFor(() => expect(bell.textContent).toBe("🔔 Alerts"));

    fireEvent.click(bell);
    await screen.findByRole("button", { name: "Save" });
    expect(screen.queryByText(/Since you last looked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/you're up to date/i)).not.toBeInTheDocument();
    // No watermark POST either — there is nothing to stamp.
    expect(calls.some((c) => String(c.opts?.body ?? "").includes('"seen":true'))).toBe(false);
  });

  it("a failing movement read never breaks the chip", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes("movement=1")
          ? Promise.reject(new Error("network down"))
          : okJson({ webhookUrl: "https://hooks.slack.com/services/T/B/xyz" }),
      ),
    );
    render(<AlertsControl org="acme" />);
    const bell = await screen.findByRole("button", { name: /Alerts/ });
    await waitFor(() => expect(bell.textContent).toBe("🔔 Alerts"));
  });
});

describe("movement formatting helpers", () => {
  it("badge label saturates with a + only when capped", () => {
    expect(movementBadgeLabel(3, false)).toBe("3");
    expect(movementBadgeLabel(9, true)).toBe("9+");
  });

  it("names each scan-pipeline event, falling back for an unknown tag", () => {
    expect(movementEventLabel("regression")).toBe("regressed");
    expect(movementEventLabel("level-change")).toBe("level change");
    expect(movementEventLabel("recommendation-closed")).toBe("gap closed");
    expect(movementEventLabel("")).toBe("moved");
  });

  it("renders a compact age", () => {
    const now = Date.parse("2026-07-27T12:00:00Z");
    expect(movementAgo("2026-07-27T11:59:30Z", now)).toBe("just now");
    expect(movementAgo("2026-07-27T11:30:00Z", now)).toBe("30m ago");
    expect(movementAgo("2026-07-27T06:00:00Z", now)).toBe("6h ago");
    expect(movementAgo("2026-07-24T12:00:00Z", now)).toBe("3d ago");
  });
});
