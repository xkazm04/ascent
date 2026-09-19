// @vitest-environment jsdom
//
// After usage became git-native, the how-to must not tell a reader they need ASCENT_TOKEN to
// sync counts into the registry. `report --to-registry` is a file write; the token sentence is
// only for sink A / MCP.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { fixtureRegistryView } from "@/lib/org/registry-view.fixture";
import { HOWTO_HOSTED_NOTE, HOWTO_USAGE_NOTE, sentencesRequiringTokenForUsageSync } from "@/lib/org/registry-howto";
import { RegistryHowTo } from "./RegistryHowTo";

const view = fixtureRegistryView("acme", "indexed")!;

describe("RegistryHowTo — git-native usage vs hosted token sinks", () => {
  it("shows report --to-registry in the git-native block, not a token-gated sync", () => {
    const { container } = render(<RegistryHowTo view={view} />);
    const native = container.querySelector("[data-howto='git-native']")!;
    expect(native.textContent).toContain("report --to-registry");
    expect(native.textContent).toContain("--contributor <id>");
    expect(native.textContent).not.toContain("ASCENT_TOKEN");
    expect(native.textContent).not.toMatch(/\bsync --org\b/);
  });

  it("shows hosted push and events in their own block", () => {
    const { container } = render(<RegistryHowTo view={view} />);
    const hosted = container.querySelector("[data-howto='hosted']")!;
    expect(hosted.textContent).toContain("push --org acme");
    expect(hosted.textContent).toContain("report --org acme");
    expect(hosted.textContent).not.toContain("--to-registry");
  });

  it("0 sentences require ASCENT_TOKEN for registry usage sync", () => {
    const { container } = render(<RegistryHowTo view={view} />);
    expect(sentencesRequiringTokenForUsageSync(container.textContent ?? "")).toEqual([]);
  });

  it("the one ASCENT_TOKEN sentence names sink A and MCP", () => {
    const { container } = render(<RegistryHowTo view={view} />);
    const text = container.textContent ?? "";
    expect(text).toContain(HOWTO_USAGE_NOTE);
    expect(text).toContain(HOWTO_HOSTED_NOTE);
    const tokenSentences = text
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.includes("ASCENT_TOKEN"));
    expect(tokenSentences).toHaveLength(1);
    expect(tokenSentences[0]).toMatch(/sink A/);
    expect(tokenSentences[0]).toMatch(/MCP/);
  });

  it("dense mode keeps git-native commands and drops the token sentence", () => {
    const { container } = render(<RegistryHowTo view={view} dense />);
    expect(container.querySelector("[data-howto='git-native']")?.textContent).toContain("--to-registry");
    expect(container.querySelector("[data-howto='hosted']")).toBeNull();
    expect(container.textContent).not.toContain("ASCENT_TOKEN");
    expect(sentencesRequiringTokenForUsageSync(container.textContent ?? "")).toEqual([]);
  });
});
