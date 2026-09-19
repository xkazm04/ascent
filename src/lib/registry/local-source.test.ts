import { describe, expect, it } from "vitest";
import { manifestRegistryField, parseLsTree } from "./local-source";

describe("parseLsTree", () => {
  it("keeps blobs with size and sha, drops submodule commits, and keeps non-ASCII paths verbatim", () => {
    const out = [
      "100644 blob aaa111    1331851\tknowledge/software-engineering/index.json",
      "160000 commit bbb222       -\tvendor/sub",
      "100644 blob ccc333      42\tmemory/semantic/über.md",
      "",
    ].join("\0");
    expect(parseLsTree(out)).toEqual([
      { path: "knowledge/software-engineering/index.json", type: "blob", size: 1331851, sha: "aaa111" },
      { path: "memory/semantic/über.md", type: "blob", size: 42, sha: "ccc333" },
    ]);
  });
});

describe("manifestRegistryField", () => {
  const manifest = "schema: ai-manifest\r\nregistry:\r\n  remote: github:xkazm04/ai-registry\r\n  local: ../ai-registry\r\nknowledge:\r\n  domains: [a]\r\n";

  it("reads both keys from the registry block, CRLF included", () => {
    expect(manifestRegistryField(manifest, "local")).toBe("../ai-registry");
    expect(manifestRegistryField(manifest, "remote")).toBe("github:xkazm04/ai-registry");
  });

  it("does not read a same-named key from another block", () => {
    expect(manifestRegistryField("other:\n  local: ../nope\n", "local")).toBeNull();
  });
});
