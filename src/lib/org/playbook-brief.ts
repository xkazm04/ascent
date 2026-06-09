// Markdown brief for a single company playbook — the "Copy for LLM" payload that lets a dev paste a
// playbook into Claude Code and have it applied to the current repo (Direction #3 + the #6 reuse).
// Pure + client-safe (no server imports), so the PlaybooksPanel can build it inline.

export function playbookMarkdown(
  p: { title: string; dimId: string; summary: string; steps: string[] },
  dimLabel: string,
): string {
  const out: string[] = [];
  out.push(`# Apply playbook: ${p.title}`);
  out.push(`Strengthens ${p.dimId} (${dimLabel}).`);
  if (p.summary) {
    out.push("");
    out.push(p.summary);
  }
  if (p.steps.length) {
    out.push("");
    out.push("## Steps");
    for (const s of p.steps) out.push(`- ${s}`);
  }
  out.push("");
  out.push("## Ask");
  out.push(
    "Apply this playbook to the current repository: implement the steps above as concrete changes, then open a pull request. Call out any step that doesn't apply here and why.",
  );
  return out.join("\n");
}
