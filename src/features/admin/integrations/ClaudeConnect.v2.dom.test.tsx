// @vitest-environment jsdom
// The Prism surface keeps the v1 mask: the mac stays out of every rendered value until Reveal,
// and both Copy buttons still put the working token on the clipboard.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ClaudeConnectV2 } from "./ClaudeConnect.v2";

const SLUG = "acme";
const MAC = "9f3c1ba27de450816cd2ef7a";
const TOKEN = `asc_otel.${SLUG}.${MAC}`;
let clipboard: string[];

beforeEach(() => {
  clipboard = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async (text: string) => { clipboard.push(text); }) },
  });
});

afterEach(() => vi.restoreAllMocks());

function setup(token = TOKEN) {
  return render(<ClaudeConnectV2 slug={SLUG} ingestToken={token} ingestPath="/api/integrations/ingest" />);
}

async function click(el: HTMLElement) {
  await act(async () => { fireEvent.click(el); });
}

function tokenValue(): string {
  return (document.getElementById("claude-token") as HTMLInputElement).value;
}

function envValue(): string {
  return (document.getElementById("claude-env") as HTMLTextAreaElement).value;
}

describe("ClaudeConnect v2 mask", () => {
  it("keeps the raw token out of the field and the snippet while masked", () => {
    const { container } = setup();
    expect(container.textContent ?? "").not.toContain(MAC);
    expect(tokenValue()).not.toContain(MAC);
    expect(envValue()).not.toContain(MAC);
    expect(envValue()).toContain(`Authorization=Bearer asc_otel.${SLUG}.`);
    expect(envValue()).toContain("•");
    expect(envValue()).not.toMatch(/OTEL_LOGS_EXPORTER\s*=\s*otlp/);
    expect(tokenValue()).toContain(`asc_otel.${SLUG}.`);
  });

  it("reveals both surfaces on one click, then hides both", async () => {
    setup();
    await click(screen.getByRole("button", { name: /reveal ingest token/i }));
    expect(tokenValue()).toContain(MAC);
    expect(envValue()).toContain(`Bearer ${TOKEN}`);
    await click(screen.getByRole("button", { name: /hide ingest token/i }));
    expect(tokenValue()).not.toContain(MAC);
    expect(envValue()).not.toContain(MAC);
  });

  it("copies the working token from the field and the snippet while the display stays masked", async () => {
    const { container } = setup();
    const copies = screen.getAllByRole("button", { name: /^copy$/i });
    expect(copies).toHaveLength(3);
    await click(copies[1]!);
    expect(clipboard.at(-1)).toBe(TOKEN);
    await click(copies[2]!);
    expect(clipboard.at(-1)).toContain(`Authorization=Bearer ${TOKEN}`);
    expect(clipboard.at(-1)).not.toContain("•");
    expect(clipboard.at(-1)).not.toMatch(/OTEL_LOGS_EXPORTER\s*=\s*otlp/);
    expect(container.textContent ?? "").not.toContain(MAC);
    expect(tokenValue()).not.toContain(MAC);
  });

  it("masks an epoch-bearing token the same way", () => {
    setup(`asc_otel.${SLUG}.e3.${MAC}`);
    expect(tokenValue()).not.toContain(MAC);
    expect(tokenValue()).toContain(`asc_otel.${SLUG}.e3.`);
    expect(envValue()).not.toContain(MAC);
  });
});
