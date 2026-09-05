// @vitest-environment jsdom
//
// Pins the leak fix: the ingest token's mask must be REAL, not decorative. The page previously showed
// `asc_otel.<slug>.••••` in the token field and then printed the full token one block below inside
// `export OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer …`, so an owner screenshotting or
// screen-sharing the Integrations page leaked the credential while believing it was hidden.
//
// The regression these tests exist to catch is the raw mac appearing ANYWHERE in the rendered DOM
// while masked — hence the whole-container assertions rather than per-element ones. The counterpart
// assertion is just as load-bearing: Copy must still put the WORKING token on the clipboard, on both
// affordances. A mask that also masks the clipboard would be a worse bug than the leak.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ClaudeCodeSetup } from "./ClaudeCodeSetup";

const SLUG = "acme";
const MAC = "9f3c1ba27de450816cd2ef7a";
const TOKEN = `asc_otel.${SLUG}.${MAC}`;

let clipboard: string[];

beforeEach(() => {
  clipboard = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async (t: string) => {
        clipboard.push(t);
      }),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(token = TOKEN) {
  return render(<ClaudeCodeSetup slug={SLUG} ingestToken={token} ingestPath="/api/integrations/ingest" />);
}

/** The copy handler is async; flush its microtasks inside act so React state settles before asserting. */
async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

describe("ClaudeCodeSetup — the ingest token mask covers every rendered surface", () => {
  it("keeps the raw token out of the DOM while masked, including the environment snippet", () => {
    const { container } = setup();
    const dom = container.textContent ?? "";

    expect(dom).not.toContain(MAC);
    expect(dom).not.toContain(TOKEN);
    // The env block is the surface that used to leak — assert on it specifically so a future refactor
    // that reintroduces a raw interpolation there fails loudly.
    const env = screen.getByText(/OTEL_EXPORTER_OTLP_HEADERS/).textContent ?? "";
    expect(env).toContain(`Authorization=Bearer asc_otel.${SLUG}.`);
    expect(env).not.toContain(MAC);
    expect(env).toContain("•");
    // The non-secret prefix stays legible so the owner can tell which org the token belongs to.
    expect(dom).toContain(`asc_otel.${SLUG}.`);
  });

  it("reveals the token in BOTH the field and the snippet on one click, and re-hides both", async () => {
    const { container } = setup();

    await click(screen.getByRole("button", { name: /reveal ingest token/i }));
    expect(container.textContent ?? "").toContain(MAC);
    expect(screen.getByText(/OTEL_EXPORTER_OTLP_HEADERS/).textContent).toContain(`Bearer ${TOKEN}`);

    await click(screen.getByRole("button", { name: /hide ingest token/i }));
    expect(container.textContent ?? "").not.toContain(MAC);
  });

  it("copies the real, usable token from both copy affordances while the display stays masked", async () => {
    const { container } = setup();

    // Copy buttons in document order: ingest endpoint, ingest token, environment snippet.
    const copies = screen.getAllByRole("button", { name: /^copy$/i });
    expect(copies).toHaveLength(3);

    await click(copies[1]);
    expect(clipboard.at(-1)).toBe(TOKEN);

    await click(copies[2]);
    expect(clipboard.at(-1)).toContain(`Authorization=Bearer ${TOKEN}`);
    expect(clipboard.at(-1)).not.toContain("•");

    // …and the page still shows nothing.
    expect(container.textContent ?? "").not.toContain(MAC);
  });

  it("masks a rotated (epoch-bearing) token the same way", () => {
    const { container } = setup(`asc_otel.${SLUG}.e3.${MAC}`);
    const dom = container.textContent ?? "";
    expect(dom).not.toContain(MAC);
    expect(dom).toContain(`asc_otel.${SLUG}.e3.`);
  });
});
