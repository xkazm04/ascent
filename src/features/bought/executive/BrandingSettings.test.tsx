// @vitest-environment jsdom
//
// Pins org-branding-white-label #1: the accent colour is validated for readability against the WHITE
// briefing PDF and a NON-BLOCKING warning is shown (the value is still saved) when it falls below the
// WCAG large-text / UI 3:1 ratio. Covers both the pure ratio helper and the rendered advisory wired to
// the colour input via aria-describedby.

import { afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OrgBranding } from "@/lib/db/branding";
import { BrandingSettings, accentContrastOnWhite, accentContrastWarning, MIN_ACCENT_CONTRAST } from "./BrandingSettings";

function branding(over: Partial<OrgBranding> = {}): OrgBranding {
  return { brandName: null, brandColor: null, logoUrl: null, ...over } as OrgBranding;
}

describe("accent contrast helper", () => {
  it("passes the readable default blue on white (>= 3:1)", () => {
    expect(accentContrastOnWhite("#2563eb")).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    expect(accentContrastWarning("#2563eb")).toBeNull();
  });

  it("flags a light accent that nearly vanishes on white", () => {
    expect(accentContrastOnWhite("#ffff00")).toBeLessThan(MIN_ACCENT_CONTRAST); // pure yellow ≈ 1.07:1
    const warning = accentContrastWarning("#eab308");
    expect(warning).toMatch(/low contrast/i);
    expect(warning).toMatch(/:1/);
  });

  it("does not false-alarm on a malformed colour", () => {
    expect(accentContrastWarning("not-a-hex")).toBeNull();
    expect(Number.isNaN(accentContrastOnWhite("#zzz"))).toBe(true);
  });
});

describe("BrandingSettings contrast advisory (DOM)", () => {
  it("shows a non-blocking warning wired to the accent input for a low-contrast colour", () => {
    render(<BrandingSettings slug="acme" initial={branding({ brandColor: "#ffee00" })} />);
    const warning = screen.getByText(/low contrast/i);
    expect(warning.closest("p")).toHaveAttribute("id", "brand-accent-warning");
    const colorInput = document.querySelector<HTMLInputElement>('input[type="color"]')!;
    expect(colorInput).toHaveAttribute("aria-describedby", "brand-accent-warning");
  });

  it("shows no warning for a readable accent", () => {
    render(<BrandingSettings slug="acme" initial={branding({ brandColor: "#1d4ed8" })} />);
    expect(screen.queryByText(/low contrast/i)).toBeNull();
    const colorInput = document.querySelector<HTMLInputElement>('input[type="color"]')!;
    expect(colorInput).not.toHaveAttribute("aria-describedby");
  });
});

// Pins org-branding-white-label 2026-07-16 #2: the picker's visible #2563eb default must not be
// silently persisted — "never chose a colour" stays a stored null (submitted as ""), and a chosen
// colour is clearable back to the default through the "Use default" affordance.
describe("BrandingSettings accent unset semantics (DOM)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubFetch() {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
      return {
        ok: true,
        json: async () => ({
          branding: {
            brandName: body.brandName || null,
            brandColor: body.brandColor || null,
            logoUrl: body.logoUrl || null,
          },
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    return fetchMock;
  }

  it("saving a name-only change submits brandColor: '' (clear), NOT the picker's visible default", async () => {
    const fetchMock = stubFetch();
    render(<BrandingSettings slug="acme" initial={branding()} />);
    fireEvent.change(screen.getByPlaceholderText("Acme Inc."), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, string>;
    expect(body.brandName).toBe("Acme");
    expect(body.brandColor).toBe(""); // deliberate clear — never the silently-persisted #2563eb
  });

  it("actually picking a colour submits it", async () => {
    const fetchMock = stubFetch();
    render(<BrandingSettings slug="acme" initial={branding()} />);
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="color"]')!, { target: { value: "#e11d48" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, string>;
    expect(body.brandColor).toBe("#e11d48");
  });

  it("'Use default' clears a stored colour: shown only when a colour is set, and submits '' after clearing", async () => {
    const fetchMock = stubFetch();
    const { unmount } = render(<BrandingSettings slug="acme" initial={branding()} />);
    expect(screen.queryByRole("button", { name: /use default/i })).toBeNull(); // unset → nothing to clear
    unmount();

    render(<BrandingSettings slug="acme" initial={branding({ brandColor: "#1d4ed8" })} />);
    const clear = screen.getByRole("button", { name: /use default/i });
    fireEvent.click(clear);
    expect(screen.queryByRole("button", { name: /use default/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, string>;
    expect(body.brandColor).toBe(""); // back to null → future default-accent changes propagate again
  });
});

// Pins org-branding-white-label 2026-07-16 #5: an exact brand hex can be TYPED (not just eyeballed in
// the OS picker) via a text twin two-way synced with the swatch; clearing it returns to the default.
describe("BrandingSettings typed hex entry (DOM)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("typing a hex updates the swatch and submits the typed value", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ branding: { brandName: null, brandColor: "#e11d48", logoUrl: null } }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    render(<BrandingSettings slug="acme" initial={branding()} />);
    fireEvent.change(screen.getByLabelText("Accent colour hex"), { target: { value: "#e11d48" } });
    expect(document.querySelector<HTMLInputElement>('input[type="color"]')!.value).toBe("#e11d48"); // two-way sync
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] && (fetchMock.mock.calls[0]![1] as RequestInit).body)) as Record<string, string>;
    expect(body.brandColor).toBe("#e11d48");
  });

  it("clearing the hex field reverts to the unset default (submits '')", () => {
    render(<BrandingSettings slug="acme" initial={branding({ brandColor: "#e11d48" })} />);
    const hex = screen.getByLabelText("Accent colour hex") as HTMLInputElement;
    expect(hex.value).toBe("#e11d48");
    fireEvent.change(hex, { target: { value: "" } });
    expect(hex.value).toBe(""); // unset again — the swatch shows the visible default only
    expect(screen.queryByRole("button", { name: /use default/i })).toBeNull();
  });
});

// Pins org-branding-white-label 2026-07-16 #4: a saved-but-not-an-image logo URL must surface as a
// warning (the server probes it with the same guarded fetch the PDF render uses), and the saved logo
// renders as a visible preview thumbnail instead of only being testable by downloading a PDF.
describe("BrandingSettings logo reachability + preview (DOM)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubFetch(logoUnreachable: boolean) {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
      return {
        ok: true,
        json: async () => ({
          branding: { brandName: body.brandName || null, brandColor: body.brandColor || null, logoUrl: body.logoUrl || null },
          logoUnreachable,
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    return fetchMock;
  }

  it("warns when the server reports the saved logo did not return an image", async () => {
    stubFetch(true);
    render(<BrandingSettings slug="acme" initial={branding()} />);
    fireEvent.change(screen.getByPlaceholderText("https://acme.com/logo.png"), { target: { value: "https://cdn.example/nope.png" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByText(/didn't return an image/i)).toBeInTheDocument());
  });

  it("shows a preview thumbnail after a reachable logo is saved (and none before)", async () => {
    stubFetch(false);
    render(<BrandingSettings slug="acme" initial={branding()} />);
    expect(screen.queryByAltText("Saved logo preview")).toBeNull(); // nothing saved yet → no preview
    fireEvent.change(screen.getByPlaceholderText("https://acme.com/logo.png"), { target: { value: "https://cdn.example/logo.png" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByAltText("Saved logo preview")).toHaveAttribute("src", "https://cdn.example/logo.png"));
    expect(screen.queryByText(/didn't return an image/i)).toBeNull();
  });
});
