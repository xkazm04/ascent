// Pairing verification — exercised against REAL filesystem state: this repository's own checkout is
// the fixture for the happy path (a working copy always exists wherever the suite runs), and the
// failure paths use paths that cannot exist. Keeps the checks honest without mocking fs or git.

import { describe, expect, it } from "vitest";
import { ownerRepoFromRemoteUrl } from "@/lib/local/git";
import { verifyLocalPath } from "@/lib/local/pairing";

describe("ownerRepoFromRemoteUrl", () => {
  it("reads owner/repo out of every common remote shape, lowercased", () => {
    expect(ownerRepoFromRemoteUrl("https://github.com/Acme/Widgets.git")).toBe("acme/widgets");
    expect(ownerRepoFromRemoteUrl("git@github.com:acme/widgets.git")).toBe("acme/widgets");
    expect(ownerRepoFromRemoteUrl("ssh://git@github.com/acme/widgets")).toBe("acme/widgets");
    expect(ownerRepoFromRemoteUrl("https://ghe.corp.example/acme/widgets")).toBe("acme/widgets");
  });

  it("returns null when no owner/repo tail is recognizable", () => {
    expect(ownerRepoFromRemoteUrl("")).toBeNull();
    expect(ownerRepoFromRemoteUrl("not a url")).toBeNull();
  });
});

describe("verifyLocalPath", () => {
  it("rejects a relative path before touching the filesystem", async () => {
    const r = await verifyLocalPath("some/relative/path", "acme/widgets");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/absolute/i);
  });

  it("rejects a folder that does not exist", async () => {
    const r = await verifyLocalPath(`${process.cwd()}/definitely-not-a-real-folder-xyz`, "acme/widgets");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/does not exist/i);
  });

  // The self-referential fixture: the suite always runs inside a real working copy of ascent.
  it("verifies this repository's own checkout as a working copy", async () => {
    const r = await verifyLocalPath(process.cwd(), "any-owner/any-name");
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.headSha).toMatch(/^[0-9a-f]{40}$/);
    // fullName deliberately doesn't match this repo's origin: the check must WARN (mismatch/unknown),
    // never block — a mirror or local-only repo is still scannable.
    expect(["mismatch", "unknown"]).toContain(r.originMatch);
  });
});
