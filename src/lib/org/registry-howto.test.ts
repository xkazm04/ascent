import { describe, expect, it } from "vitest";
import {
  HOWTO_HOSTED_NOTE,
  HOWTO_USAGE_NOTE,
  registryHowTo,
  sentencesRequiringTokenForUsageSync,
  splitHowToSentences,
} from "./registry-howto";

describe("registryHowTo", () => {
  const howTo = registryHowTo("acme/ai-registry", "acme");

  it("git-native usage is report --to-registry with no token, org, or URL", () => {
    expect(howTo.reportCmd).toBe("node scripts/ascent-skills.mjs report --to-registry --contributor <id>");
    expect(howTo.reportCmd).not.toMatch(/ASCENT_TOKEN|--token|--org|--url/);
    expect(howTo.hooksCmd).toBe("node scripts/ascent-skills.mjs hooks install");
    expect(howTo.pointer).toBe("registry.remote: github:acme/ai-registry");
  });

  it("hosted push and events still name the org and are not the usage lane", () => {
    expect(howTo.hostedPushCmd).toBe("node scripts/ascent-skills.mjs push --org acme");
    expect(howTo.hostedEventsCmd).toBe("node scripts/ascent-skills.mjs report --org acme");
    expect(howTo.hostedEventsCmd).not.toContain("--to-registry");
    expect(howTo.syncCmd).toBe("node scripts/ascent-skills.mjs sync --org acme");
  });
});

describe("how-to notes — token only for sink A / MCP", () => {
  it("usage note names report --to-registry and never ASCENT_TOKEN", () => {
    expect(HOWTO_USAGE_NOTE).toContain("report --to-registry");
    expect(HOWTO_USAGE_NOTE).toContain("usage/<contributor>.json");
    expect(HOWTO_USAGE_NOTE).toMatch(/no token/i);
    expect(HOWTO_USAGE_NOTE).not.toContain("ASCENT_TOKEN");
  });

  it("hosted note names ASCENT_TOKEN only with sink A and MCP", () => {
    expect(HOWTO_HOSTED_NOTE).toContain("ASCENT_TOKEN");
    expect(HOWTO_HOSTED_NOTE).toMatch(/sink A/);
    expect(HOWTO_HOSTED_NOTE).toMatch(/MCP/);
    expect(HOWTO_HOSTED_NOTE).not.toContain("--to-registry");
    expect(HOWTO_HOSTED_NOTE).not.toMatch(/usage\//);
  });

  it("0 sentences require ASCENT_TOKEN for registry usage sync", () => {
    const blob = `${HOWTO_USAGE_NOTE} ${HOWTO_HOSTED_NOTE}`;
    expect(sentencesRequiringTokenForUsageSync(blob)).toEqual([]);
  });

  it("still flags the pre-git-native 'Sync reads ASCENT_TOKEN' line", () => {
    const old =
      "ascent-skills.mjs is one zero-dependency file. Sync reads an askl_ token from ASCENT_TOKEN (mint one on the Skills tab).";
    expect(sentencesRequiringTokenForUsageSync(old)).toHaveLength(1);
  });

  it("splitHowToSentences keeps a parenthetical token sentence as one unit", () => {
    const parts = splitHowToSentences(HOWTO_HOSTED_NOTE);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain("ASCENT_TOKEN");
  });
});
