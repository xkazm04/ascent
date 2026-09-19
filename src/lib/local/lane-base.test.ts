// WHAT THE LOOP CAN HONESTLY KNOW ABOUT TWO SCANS' BASES.
//
// The claim worth the most here is the NEGATIVE one, and it is the opposite of the usual: this rule
// may only ever take a claim away, and it may only do so on PROOF. Every "I could not tell" case —
// a missing sha, a commit this checkout has never seen, a git that is not there at all — must come
// back `unknown`, because an unknown base is not a differing base, and refusing a pair on absent data
// is precisely the error the attribution module exists to prevent.

import { describe, expect, it, vi } from "vitest";
import { baseRelation, type GitAsk } from "./lane-base";

/** A git seam that knows a set of commits and an ancestry edge, and refuses everything else the way
 *  the real `runGit` does — with `ok: false`, no exit code, no distinction. */
const git = (present: readonly string[], ancestor: readonly [string, string][] = []): GitAsk =>
  vi.fn(async (args: readonly string[]) => {
    if (args[0] === "cat-file") return present.some((sha) => args[2] === `${sha}^{commit}`);
    if (args[0] === "merge-base") return ancestor.some(([b, a]) => b === args[2] && a === args[3]);
    return false;
  });

const end = (headSha: string | null) => ({ headSha });

describe("baseRelation", () => {
  it("is `shared` for the same commit, without asking git at all", async () => {
    const ask = git([]);
    expect(await baseRelation(end("abc"), end("abc"), ask)).toBe("shared");
    expect(ask).not.toHaveBeenCalled();
  });

  it("is `shared` when the before commit is an ANCESTOR of the after commit — a lane's own work", async () => {
    // This is the ordinary shape: the worktree branch is cut from the before-scan's commit and the
    // agent's commits land on top of it.
    expect(await baseRelation(end("base"), end("tip"), git(["base", "tip"], [["base", "tip"]]))).toBe("shared");
  });

  it("is `diverged` only when BOTH commits are present and neither line contains the other", async () => {
    // Run a97baf88's `kp`: the before-scan pinned the autopilot branch's tip, then a person switched
    // the checkout to `main` and the lane branched from there.
    expect(await baseRelation(end("autopilot-tip"), end("main-tip"), git(["autopilot-tip", "main-tip"]))).toBe("diverged");
  });

  it("is `unknown` when either end recorded no sha — the common case, and never a refusal", async () => {
    const ask = git(["x"]);
    expect(await baseRelation(end(null), end("x"), ask)).toBe("unknown");
    expect(await baseRelation(end("x"), end(null), ask)).toBe("unknown");
    expect(await baseRelation(end("  "), end("x"), ask)).toBe("unknown");
    expect(await baseRelation(null, null, ask)).toBe("unknown");
    expect(ask).not.toHaveBeenCalled();
  });

  it("is `unknown` when a commit is not in this checkout — a missing object is not a divergence", async () => {
    // THE WHOLE REASON THE PRESENCE CHECK EXISTS. `merge-base --is-ancestor` answers "no" and "I have
    // never heard of that commit" identically through `runGit`, which surfaces only `ok`. Without the
    // check, a garbage-collected or never-fetched sha would read as proof the bases differ.
    expect(await baseRelation(end("gone"), end("tip"), git(["tip"]))).toBe("unknown");
    expect(await baseRelation(end("base"), end("gone"), git(["base"]))).toBe("unknown");
  });

  it("is `unknown` when there is no git to ask", async () => {
    expect(await baseRelation(end("a"), end("b"), async () => false)).toBe("unknown");
  });
});
