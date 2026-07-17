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

/** Type a new candidate URL into the webhook field, making the form dirty. */
function editWebhook(value: string) {
  fireEvent.change(screen.getByPlaceholderText("https://hooks.slack.com/services/…"), { target: { value } });
}

describe("AlertsControl result announcements (fleet-alerts #6)", () => {
  it("announces a successful save in a polite live region", async () => {
    const url = "https://hooks.slack.com/services/T/B/xyz";
    mockFetch((_u, opts) =>
      opts?.method === "POST" ? okJson({ webhookUrl: url }) : okJson({ webhookUrl: url }),
    );
    const save = await openWithSavedWebhook();
    editWebhook("https://hooks.slack.com/services/T/B/new");
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
    editWebhook("https://hooks.slack.com/services/T/B/new");
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Slack rejected the webhook."));
  });
});

describe("AlertsControl dirty-state guard (ambiguity-ui 2026-07-16 #4)", () => {
  it("disables Save on a pristine form and enables it once the webhook is edited", async () => {
    const url = "https://hooks.slack.com/services/T/B/xyz";
    mockFetch(() => okJson({ webhookUrl: url }));
    const save = await openWithSavedWebhook();
    expect(save).toBeDisabled(); // nothing changed — nothing to save
    editWebhook("https://hooks.slack.com/services/T/B/new");
    expect(save).toBeEnabled();
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
  });

  it("suffixes the test-delivery notice with 'not saved yet' when the tested URL is an unsaved draft", async () => {
    const url = "https://hooks.slack.com/services/T/B/xyz";
    mockFetch((_u, opts) => (opts?.method === "POST" ? okJson({ delivered: true }) : okJson({ webhookUrl: url })));
    await openWithSavedWebhook();
    editWebhook("https://hooks.slack.com/services/T/B/candidate");
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Test alert delivered ✓ — not saved yet"));
  });

  it("a clean form's test notice stays terminal (no misleading 'not saved yet')", async () => {
    const url = "https://hooks.slack.com/services/T/B/xyz";
    mockFetch((_u, opts) => (opts?.method === "POST" ? okJson({ delivered: true }) : okJson({ webhookUrl: url })));
    await openWithSavedWebhook();
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Test alert delivered ✓"));
    expect(screen.getByRole("status")).not.toHaveTextContent("not saved yet");
  });
});
