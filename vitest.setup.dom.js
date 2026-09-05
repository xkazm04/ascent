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
}
