// Test setup for the DOM-environment tests. Plain JS, like vitest.config.js, so it stays invisible to
// `tsc --noEmit`.
//
// The suite's DEFAULT environment is still `node` — 3100+ existing tests run there and must keep doing so
// (they are pure logic, and node is much faster). A component test opts in per file with a docblock:
//
//     // @vitest-environment jsdom
//
// This file is loaded for EVERY test file, so it has to be inert under node. The `document` guard is what
// makes that true: under node it does nothing, under jsdom it wires up the two things every component test
// wants — jest-dom's matchers, and an automatic unmount between tests (without which React state leaks
// across cases and a passing test can be an accident of ordering).
import { expect, afterEach } from "vitest";

if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  const matchers = await import("@testing-library/jest-dom/matchers");
  expect.extend(matchers.default ?? matchers);
  afterEach(() => {
    cleanup();
  });

  // jsdom implements no `matchMedia`, so ANY component reaching a media query throws an uncaught
  // TypeError rather than failing an assertion — the failure names the render, not the missing API,
  // which is a long detour to debug. Every chart in @/components/org/viz calls
  // usePrefersReducedMotion, so as the /org redesign lands, existing DOM tests that never touched a
  // media query start crashing the moment a panel adopts a kit chart. One guard here beats the same
  // stub copied into every test file (measured: five wave agents each hit this independently).
  //
  // Installed ONLY when absent, and it reports "no preference": the reduced-motion path is a
  // deliberate branch that its own tests assert by assigning their own stub over this one, and a
  // default of `matches: true` would silently take every other test down the reduced path.
  if (typeof window !== "undefined" && !window.matchMedia) {
    window.matchMedia = (query) => ({
      media: query,
      matches: false,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
  }
}
