// @vitest-environment jsdom
//
// Pins bug-ui-scan #1: <Reveal> is the public front door's wrapper (almost every /about + index landing
// block sits inside one). The prior framer-motion version emitted an inline `opacity:0` into the SSR
// HTML, so a no-JS visitor / non-executing crawler / failed hydration saw a BLANK page. These tests lock
// in the contract that the server/no-JS state is VISIBLE and the reveal is pure progressive enhancement.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Reveal } from "./Reveal";

afterEach(() => vi.restoreAllMocks());

describe("Reveal (DOM)", () => {
  it("server-renders the content VISIBLE — no inline opacity, no hidden class in the SSR HTML", () => {
    // renderToStaticMarkup runs no effects, so the output mirrors the true SSR / no-JS render. (React
    // logs a benign 'useLayoutEffect does nothing on the server' note here because jsdom sets `window`;
    // real SSR has no window and takes the useEffect branch. Silence it so the suite output stays clean.)
    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(<Reveal>Readable without JavaScript</Reveal>);

    expect(html).toContain("Readable without JavaScript");
    // The exact regression: the blanking start state must NOT be in the server output.
    expect(html).not.toMatch(/opacity\s*:\s*0/);
    expect(html).not.toContain("js-reveal");
    expect(html).not.toContain("is-revealed");
  });

  it("never emits an inline opacity style (the hidden start is class-gated, not baked in)", () => {
    const { container } = render(
      <Reveal className="probe">
        <p>front door copy</p>
      </Reveal>,
    );
    const el = container.querySelector(".probe") as HTMLElement;
    expect(el).toBeInTheDocument();
    expect(el.style.opacity).toBe("");
    expect(el.getAttribute("style") ?? "").not.toContain("opacity");
  });

  it("progressively enhances after mount — arms and reveals so content ends visible", () => {
    // jsdom has no IntersectionObserver, so Reveal takes its degrade-to-visible fallback: it arms
    // (`.js-reveal`) and immediately reveals (`.is-revealed`) rather than stranding the content hidden.
    const { container } = render(
      <Reveal className="probe" y={40} delay={0.2}>
        <span>enhanced</span>
      </Reveal>,
    );
    const el = container.querySelector(".probe") as HTMLElement;
    expect(el).toHaveClass("js-reveal");
    expect(el).toHaveClass("is-revealed");
    // The custom props that drive the CSS transition are threaded through, not an inline opacity.
    expect(el.style.getPropertyValue("--reveal-y")).toBe("40px");
    expect(el.style.getPropertyValue("--reveal-delay")).toBe("0.2s");
  });
});
