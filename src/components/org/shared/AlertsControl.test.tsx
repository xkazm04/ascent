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

/** The sink field's placeholder — it names BOTH accepted forms, because `mailto:` is a first-class
 *  sink value (G7-01) and this field is its only configuration surface. */
const WEBHOOK_PLACEHOLDER = "https://hooks.slack.com/services/… or mailto:you@example.com";

/** Type a new candidate URL into the webhook field, making the form dirty. */
function editWebhook(value: string) {
  // Located by placeholder, matching the three sibling assertions in this file. The field also has an
  // accessible NAME now (it had none — only the dialog did), pinned separately below so that fix has
  // a test of its own rather than riding on a locator choice.
  fireEvent.change(screen.getByPlaceholderText(WEBHOOK_PLACEHOLDER), { target: { value } });
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
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Test alert delivered ✓ (not saved yet)"));
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

describe("AlertsControl load failure — a blank slate must not overwrite saved settings", () => {
  it("hides the form on a 5xx instead of rendering it blank", async () => {
    // The 5xx never reached the `.catch`, so the old code fell through to `r.json().catch(() => ({}))`
    // and rendered a form with an empty webhook and empty thresholds — indistinguishable from an org
    // that genuinely has none, and with no error shown at all.
    mockFetch((u) =>
      String(u).includes("movement=1")
        ? okJson({ movement: null })
        : Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "boom" }) }),
    );
    render(<AlertsControl org="acme" />);
    fireEvent.click(screen.getByRole("button", { name: "Alerts" }));

    await waitFor(() => expect(screen.getByText(/Couldn't load this org's alert settings/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByPlaceholderText(WEBHOOK_PLACEHOLDER)).toBeNull();
  });

  it("hides the form when the GET rejects outright", async () => {
    mockFetch((u) =>
      String(u).includes("movement=1") ? okJson({ movement: null }) : Promise.reject(new Error("offline")),
    );
    render(<AlertsControl org="acme" />);
    fireEvent.click(screen.getByRole("button", { name: "Alerts" }));

    await waitFor(() => expect(screen.getByText(/Couldn't load this org's alert settings/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("still shows the admins-only note on a 403 — a denial is not a load failure", async () => {
    mockFetch((u) =>
      String(u).includes("movement=1")
        ? okJson({ movement: null })
        : Promise.resolve({ ok: false, status: 403, json: async () => ({}) }),
    );
    render(<AlertsControl org="acme" />);
    fireEvent.click(screen.getByRole("button", { name: "Alerts" }));

    await waitFor(() => expect(screen.getByText("Only org admins can configure alert routing.")).toBeInTheDocument());
    expect(screen.queryByText(/Couldn't load this org's alert settings/)).toBeNull();
  });
});

describe("AlertsControl names the email sink — its only configuration surface", () => {
  it("offers mailto: in the prose and the placeholder", async () => {
    // G7-01 shipped an email sink end to end (validation branch, renderer, transport, unsubscribe
    // route) and this field is the only place an admin can set one. Naming only the Slack form made a
    // whole delivery channel undiscoverable to the orgs it was built for.
    mockFetch((u) => (String(u).includes("movement=1") ? okJson({ movement: null }) : okJson({ webhookUrl: null })));
    render(<AlertsControl org="acme" />);
    fireEvent.click(screen.getByRole("button", { name: "Alerts" }));

    await screen.findByRole("button", { name: "Save" });
    expect(screen.getByPlaceholderText(WEBHOOK_PLACEHOLDER)).toBeInTheDocument();
    expect(WEBHOOK_PLACEHOLDER).toMatch(/mailto:/);
    expect(screen.getByText("mailto:you@example.com")).toBeInTheDocument();
  });

  it("gives the sink field an accessible NAME, not just a placeholder", async () => {
    // The dialog carried an aria-label; its primary control carried none, so a screen reader announced
    // an unnamed edit box. A placeholder is not an accessible name — it disappears on input and is not
    // reliably announced — and the two threshold fields beside this one have had real labels all along.
    mockFetch((u) => (String(u).includes("movement=1") ? okJson({ movement: null }) : okJson({ webhookUrl: null })));
    render(<AlertsControl org="acme" />);
    fireEvent.click(screen.getByRole("button", { name: "Alerts" }));
    await screen.findByRole("button", { name: "Save" });

    const field = screen.getByLabelText(/Alert sink/i);
    expect(field).toBe(screen.getByPlaceholderText(WEBHOOK_PLACEHOLDER)); // same element, two locators
    // …and it points at the copy that explains what the field accepts.
    expect(field).toHaveAttribute("aria-describedby", "alert-sink-help");
  });
});
