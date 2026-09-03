# `.ai/memory`: the codebase's durable memory

Structured, **append-only** memory that agents read *before* acting and write *after* learning. It
exists so hard-won knowledge (why a decision was made, a non-obvious gotcha, an approach that was
tried and **failed**) survives past a single session and isn't rediscovered the hard way.

This is not prose drift in a guidance file. It is one fact per file, each with frontmatter so it can
be indexed, filtered, and superseded. The format is referenced from `.ai/manifest.yaml`
(`paths.memory`), so it can change without breaking the contract.

## One fact per file

Name files `NNNN-short-slug.md` (zero-padded, monotonic). Frontmatter schema:

    ---
    id: 0007
    kind: failed-approach   # decision | gotcha | failed-approach | convention | reference | <open>
    scope: module:engine    # repo | path:<dir> | module:<id>
    date: 2026-06-10
    supersedes: null        # id of a memory this replaces, or null
    refs: []                # related memory ids or module ids
    ---

    One paragraph: what was learned, and (for a decision) **why**. For a failed-approach, say what
    was tried and the symptom that ruled it out, so no one (human or agent) burns the same hours.

`kind` and `scope` are an **open vocabulary**. Add values when you need them; readers ignore ones
they don't recognize.

## The norms that make it work

- **Before a non-trivial change:** scan memories whose `scope` covers the files you're about to touch.
- **After a non-trivial change:** if you learned something durable (a decision, a gotcha, a dead end),
  append a memory. Keep it to one fact.
- **Never rewrite history.** Superseding beats editing: add a new file and set `supersedes`.
- **Vendor-neutral.** Any coding agent can read and write this; it names no tool.

The first entry below records adopting this standard: it doubles as a worked example of the format.
