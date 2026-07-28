// @vitest-environment jsdom
// Pins "Export CSV" as UI rather than a top-level navigation into an auth-gated JSON endpoint (G5-16):
//   • 401 (expired session) → an in-page re-auth prompt; the page is NOT replaced by a raw JSON body.
//   • other failures → a retryable inline error.
//   • success → the CSV is fetched and downloaded via a Blob, using the server's filename.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExportCsvButton } from "@/app/trends/ExportCsvButton";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // jsdom implements neither of these.
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ExportCsvButton", () => {
  it("renders an expired-session prompt on 401 instead of navigating to the JSON error body", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: "Sign in to view history." }), { status: 401 }),
    ) as unknown as typeof fetch;

    render(<ExportCsvButton repo="acme/repo" />);
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/session expired/i);
    expect(screen.getByRole("button", { name: /sign in again/i })).toBeTruthy();
    // The export button is still there — the trends page was never blown away.
    expect(screen.getByRole("button", { name: /export csv/i })).toBeTruthy();
  });

  it("renders a retryable error on a server failure", async () => {
    globalThis.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;

    render(<ExportCsvButton repo="acme/repo" />);
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/export failed/i);
  });

  it("downloads the CSV via a Blob on success, honouring the server's filename", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("scannedAt,overall\n2026-01-01,80\n", {
          status: 200,
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": 'attachment; filename="ascent-trends-acme-repo-2026-01-01.csv"',
          },
        }),
    ) as unknown as typeof fetch;

    const clicked: { href: string; download: string }[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          clicked.push({ href: (el as HTMLAnchorElement).href, download: (el as HTMLAnchorElement).download });
        });
      }
      return el;
    });

    render(<ExportCsvButton repo="acme/repo" />);
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0]!.download).toBe("ascent-trends-acme-repo-2026-01-01.csv");
    expect(clicked[0]!.href).toContain("blob:");
    expect(screen.queryByRole("alert")).toBeNull();
    // The fetch went to the CSV endpoint for this repo.
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]![0])).toContain(
      "/api/history?repo=acme%2Frepo&format=csv",
    );
  });
});
