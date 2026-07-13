// @vitest-environment jsdom
//
// Pins fleet-alerts-digests #6: Save / Clear / Send-test outcomes (and errors) are announced to screen
// readers through a persistent polite live region. Previously these were plain <p>s that mounted on
// demand, so no SR voiced them and a keyboard/SR admin got no confirmation the webhook saved or the
// test delivered.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AlertsControl } from "./AlertsControl";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Handler = (url: string, opts?: RequestInit) => Promise<Partial<Response>>;
function mockFetch(handler: Handler) {
  const f = vi.fn((url: string, opts?: RequestInit) => handler(url, opts));
  vi.stubGlobal("fetch", f);
  return f;
}

const okJson = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body });

async function openWithSavedWebhook() {
  render(<AlertsControl org="acme" />);
  fireEvent.click(screen.getByRole("button", { name: "Alerts" }));
  // Wait for the lazy GET to resolve and the form (Save button) to render.
  return screen.findByRole("button", { name: "Save" });
}

describe("AlertsControl result announcements (fleet-alerts #6)", () => {
  it("announces a successful save in a polite live region", async () => {
    const url = "https://hooks.slack.com/services/T/B/xyz";
    mockFetch((_u, opts) =>
      opts?.method === "POST" ? okJson({ webhookUrl: url }) : okJson({ webhookUrl: url }),
    );
    const save = await openWithSavedWebhook();
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
  });

  it("announces a save failure in the live region", async () => {
    const url = "https://hooks.slack.com/services/T/B/xyz";
    mockFetch((_u, opts) =>
      opts?.method === "POST"
        ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "Slack rejected the webhook." }) })
        : okJson({ webhookUrl: url }),
    );
    const save = await openWithSavedWebhook();
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Slack rejected the webhook."));
  });
});
